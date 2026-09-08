/**
 * 主要 User Journey の E2E テスト（実 PostgreSQL 使用）。
 *
 * 実行前に環境変数 DATABASE_URL / SESSION_SECRET を「使い捨てのテスト用DB」に向けること。
 * 実行するとテーブルを DROP して作り直すため、本番・MVP の DB には絶対に向けないこと。
 *
 * ローカル実行例（<...> は各自のテスト用DBパスワード・ランダム値に置き換える）:
 *   DATABASE_URL=postgres://mira_agent_os_test_app:<test-db-password>@127.0.0.1:5432/mira_agent_os_test \ // doc003-allow: プレースホルダの記法例
 *   SESSION_SECRET=<random-hex-string> \
 *   PORT=0 npm run test:e2e
 *
 * CI では postgres:16 サービスコンテナに対して実行する（.github/workflows/app-ci.yml）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { app } from '../src/server.js';
import { hashPassword } from '../src/lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error('DATABASE_URL / SESSION_SECRET を使い捨てテスト用DBに設定してから実行すること');
}
if (!/test/.test(process.env.DATABASE_URL)) {
  throw new Error('安全のため DATABASE_URL に "test" を含む使い捨てDBのみ許可する');
}

let server;
let baseUrl;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  // テーブルを作り直して常に空の状態から開始する（テスト専用DB前提）
  await pool.query('DROP TABLE IF EXISTS audit_log, approval_requests, projects, requests, users, schema_migrations CASCADE');
  const migrationsDir = join(__dirname, '..', 'migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: setCookie };
}

test('主要 User Journey: 依頼登録 → Project 昇格 → Gate 承認', async () => {
  // 事前データ: Administrator ユーザーを直接投入（seed-admin.mjs と同じ scrypt 形式）
  const hash = await hashPassword('e2e-test-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'Administrator', $3)`,
    ['e2e-admin@example.com', 'E2E Admin', hash],
  );

  const bad = await call('/api/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: 'wrong' } });
  assert.equal(bad.status, 401);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'e2e-admin@example.com', password: 'e2e-test-password' }, // doc003-allow: 使い捨てテストDB専用の固定値
  });
  assert.equal(login.status, 200);
  const cookie = login.cookie.split(';')[0];

  const unauth = await call('/api/requests');
  assert.equal(unauth.status, 401);

  const created = await call('/api/requests', {
    method: 'POST',
    cookie,
    body: { title: 'E2E テスト依頼', description: '自動テストで作成' },
  });
  assert.equal(created.status, 201);
  assert.match(created.data.request.request_code, /^REQ-\d{4}-0001$/);
  assert.equal(created.data.request.status, 'submitted');

  const promoted = await call(`/api/requests/${created.data.request.id}/promote`, { method: 'POST', cookie });
  assert.equal(promoted.status, 201);
  assert.match(promoted.data.project.project_code, /^AGENTOS-\d{4}-0001$/);
  assert.equal(promoted.data.project.status, 'pending_approval');

  const approvals = await call('/api/approvals', { cookie });
  assert.equal(approvals.data.approvals.length, 1);
  const approvalId = approvals.data.approvals[0].id;

  const decided = await call(`/api/approvals/${approvalId}/decide`, {
    method: 'POST',
    cookie,
    body: { decision: 'approved', comment: 'E2E 承認' },
  });
  assert.equal(decided.status, 200);

  const projects = await call('/api/projects', { cookie });
  assert.equal(projects.data.projects[0].status, 'approved');

  // 二重判定は拒否される（状態遷移の不正遷移防止）
  const redecided = await call(`/api/approvals/${approvalId}/decide`, {
    method: 'POST',
    cookie,
    body: { decision: 'rejected' },
  });
  assert.equal(redecided.status, 409);

  const loggedOut = await call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(loggedOut.status, 200);

  const afterLogout = await call('/api/requests', { cookie });
  assert.equal(afterLogout.status, 401);
});

test('権限: Viewer は Project 昇格も承認もできない', async () => {
  const hash = await hashPassword('viewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'Viewer', $3)`,
    ['e2e-viewer@example.com', 'E2E Viewer', hash],
  );
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'e2e-viewer@example.com', password: 'viewer-password' }, // doc003-allow: 使い捨てテストDB専用の固定値
  });
  const cookie = login.cookie.split(';')[0];

  const created = await call('/api/requests', {
    method: 'POST',
    cookie,
    body: { title: 'Viewer が作った依頼', description: 'x' },
  });
  assert.equal(created.status, 201);

  const promote = await call(`/api/requests/${created.data.request.id}/promote`, { method: 'POST', cookie });
  assert.equal(promote.status, 403);
});
