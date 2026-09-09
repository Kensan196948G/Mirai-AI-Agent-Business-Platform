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
import { assertTestDatabaseUrl } from '../src/lib/test-db-guard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error('DATABASE_URL / SESSION_SECRET を使い捨てテスト用DBに設定してから実行すること');
}
assertTestDatabaseUrl(process.env.DATABASE_URL); // F-34: DB 名・ロールの許可リスト

const ALL_TABLES = [
  'orchestration_steps', 'orchestrations', 'worker_heartbeats', 'artifact_citations', 'artifacts', 'effect_ledger', 'budget_reservations', 'run_events', 'agent_runs',
  'source_records', 'agent_skill_bindings', 'skill_versions', 'agent_versions',
  'chat_messages', 'chat_conversations', 'task_tool_calls', 'tasks', 'knowledge_candidates',
  'approval_steps', 'approval_requests', 'project_kpis', 'projects', 'requests',
  'integrations', 'agents_config', 'skills_registry', 'model_router',
  'audit_anchors', 'audit_log', 'users', 'schema_migrations',
];

let server;
let baseUrl;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  // テーブルを作り直して常に空の状態から開始する（テスト専用DB前提）
  await pool.query(`DROP TABLE IF EXISTS ${ALL_TABLES.join(', ')} CASCADE`);
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

async function loginAs(email, password) {
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `login failed for ${email}: ${JSON.stringify(login.data)}`);
  return login.cookie.split(';')[0];
}

async function createUser(email, name, role, password) {
  const hash = await hashPassword(password); // doc003-allow: 使い捨てテストDB専用の固定値
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, name, role, hash],
  );
  return rows[0].id;
}

test('主要 User Journey: 依頼登録 → Project昇格 → 状態遷移 → Gate承認', async () => {
  await createUser('e2e-admin@example.com', 'E2E Admin', 'Administrator', 'e2e-test-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-admin@example.com', 'e2e-test-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  // SoD: 申請者本人は自分の承認を判定できないため、決裁は別のAdministratorで行う。
  await createUser('e2e-admin-approver@example.com', 'E2E Admin Approver', 'Administrator', 'e2e-test-password2'); // doc003-allow: 使い捨てテストDB専用の固定値
  const approverCookie = await loginAs('e2e-admin-approver@example.com', 'e2e-test-password2'); // doc003-allow: 使い捨てテストDB専用の固定値

  const bad = await call('/api/auth/login', { method: 'POST', body: { email: 'e2e-admin@example.com', password: 'wrong' } });
  assert.equal(bad.status, 401);

  const unauth = await call('/api/requests');
  assert.equal(unauth.status, 401);

  const created = await call('/api/requests', {
    method: 'POST', cookie, body: { title: 'E2E テスト依頼', description: '自動テストで作成' },
  });
  assert.equal(created.status, 201);
  assert.match(created.data.request.request_code, /^REQ-\d{4}-0001$/);
  assert.equal(created.data.request.status, 'submitted');

  const promoted = await call(`/api/requests/${created.data.request.id}/promote`, { method: 'POST', cookie });
  assert.equal(promoted.status, 201);
  assert.match(promoted.data.project.project_code, /^AGENTOS-\d{4}-0001$/);
  assert.equal(promoted.data.project.status, 'idea');
  const projectId = promoted.data.project.id;

  // idea → proposed（承認不要の低リスク遷移）
  const t1 = await call(`/api/projects/${projectId}/transition`, { method: 'POST', cookie, body: { to: 'proposed' } });
  assert.equal(t1.status, 200);
  assert.equal(t1.data.project.status, 'proposed');

  // proposed → approved（project_gate 承認が必要。project状態はまだ変わらない）
  const t2 = await call(`/api/projects/${projectId}/transition`, { method: 'POST', cookie, body: { to: 'approved' } });
  assert.equal(t2.status, 200);
  assert.ok(t2.data.pending_approval);
  assert.match(t2.data.pending_approval.approval_code, /^APR-\d+$/);

  const stillProposed = await call(`/api/projects/${projectId}`, { cookie });
  assert.equal(stillProposed.data.project.status, 'proposed');

  const approvals = await call('/api/approvals', { cookie });
  assert.equal(approvals.data.approvals.length, 1);
  const approvalId = approvals.data.approvals[0].id;

  const detail = await call(`/api/approvals/${approvalId}`, { cookie });
  assert.equal(detail.data.steps.length, 1);
  assert.equal(detail.data.steps[0].role, 'Approver');
  const stepId = detail.data.steps[0].id;

  // 申請者本人（e2e-admin）は自分の承認を判定できない（SoD）
  const selfDecide = await call(`/api/approvals/${approvalId}/steps/${stepId}/decide`, {
    method: 'POST', cookie, body: { decision: 'approved', reason: '自己承認テスト' },
  });
  assert.equal(selfDecide.status, 403);

  // Administrator は role制約を越えて（全ロール代理として）決裁できる。ただし別人であること。
  const decided = await call(`/api/approvals/${approvalId}/steps/${stepId}/decide`, {
    method: 'POST', cookie: approverCookie, body: { decision: 'approved', reason: 'E2E 承認' },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.data.status, 'approved');
  assert.equal(decided.data.project_status, 'approved');

  const afterApproval = await call(`/api/projects/${projectId}`, { cookie });
  assert.equal(afterApproval.data.project.status, 'approved');

  // 二重判定は拒否される
  const redecided = await call(`/api/approvals/${approvalId}/steps/${stepId}/decide`, {
    method: 'POST', cookie: approverCookie, body: { decision: 'rejected' },
  });
  assert.equal(redecided.status, 409);

  const loggedOut = await call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(loggedOut.status, 200);

  const afterLogout = await call('/api/requests', { cookie });
  assert.equal(afterLogout.status, 401);
});

test('権限: Viewer は Project 昇格も承認もできない', async () => {
  await createUser('e2e-viewer@example.com', 'E2E Viewer', 'Viewer', 'viewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-viewer@example.com', 'viewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値

  const created = await call('/api/requests', { method: 'POST', cookie, body: { title: 'Viewer が作った依頼', description: 'x' } });
  assert.equal(created.status, 201);

  const promote = await call(`/api/requests/${created.data.request.id}/promote`, { method: 'POST', cookie });
  assert.equal(promote.status, 403);
});

test('多段階承認: production_release は Reviewer→Approver の2段', async () => {
  const adminId = await createUser('e2e-admin2@example.com', 'E2E Admin2', 'Administrator', 'admin-password2'); // doc003-allow: 使い捨てテストDB専用の固定値
  await createUser('e2e-reviewer@example.com', 'E2E Reviewer', 'Reviewer', 'reviewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  await createUser('e2e-approver@example.com', 'E2E Approver', 'Approver', 'approver-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const adminCookie = await loginAs('e2e-admin2@example.com', 'admin-password2'); // doc003-allow: 使い捨てテストDB専用の固定値

  const { rows } = await pool.query(
    `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id, status)
     VALUES ('AGENTOS-9999-0001', 'テスト案件', 'x',
       (SELECT id FROM requests LIMIT 1), $1, $1, 'staging') RETURNING id`,
    [adminId],
  );
  const projectId = rows[0].id;

  const t = await call(`/api/projects/${projectId}/transition`, { method: 'POST', cookie: adminCookie, body: { to: 'production' } });
  assert.equal(t.status, 200);
  const approvalId = t.data.pending_approval.id;

  const detail = await call(`/api/approvals/${approvalId}`, { cookie: adminCookie });
  assert.deepEqual(detail.data.steps.map((s) => s.role), ['Reviewer', 'Approver']);
  const [reviewerStep, approverStep] = detail.data.steps;

  // Approverが先に決裁しようとしても、前段のReviewerが未承認のため拒否される
  const approverCookie = await loginAs('e2e-approver@example.com', 'approver-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const outOfOrder = await call(`/api/approvals/${approvalId}/steps/${approverStep.id}/decide`, {
    method: 'POST', cookie: approverCookie, body: { decision: 'approved' },
  });
  assert.equal(outOfOrder.status, 409);

  const reviewerCookie = await loginAs('e2e-reviewer@example.com', 'reviewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const reviewed = await call(`/api/approvals/${approvalId}/steps/${reviewerStep.id}/decide`, {
    method: 'POST', cookie: reviewerCookie, body: { decision: 'approved' },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.status, 'in_review');

  const finalDecision = await call(`/api/approvals/${approvalId}/steps/${approverStep.id}/decide`, {
    method: 'POST', cookie: approverCookie, body: { decision: 'approved' },
  });
  assert.equal(finalDecision.status, 200);
  assert.equal(finalDecision.data.status, 'approved');

  const project = await call(`/api/projects/${projectId}`, { cookie: adminCookie });
  assert.equal(project.data.project.status, 'production');
});

test('Task / Knowledge の作成・一覧・Audit Hash Chain 検証', async () => {
  const adminId = await createUser('e2e-admin3@example.com', 'E2E Admin3', 'Administrator', 'admin-password3'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-admin3@example.com', 'admin-password3'); // doc003-allow: 使い捨てテストDB専用の固定値

  const { rows } = await pool.query(
    `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id)
     VALUES ('AGENTOS-9999-0002', 'テスト案件2', 'x', (SELECT id FROM requests LIMIT 1), $1, $1) RETURNING id`,
    [adminId],
  );
  const projectId = rows[0].id;

  const task = await call('/api/tasks', {
    method: 'POST', cookie,
    body: { projectId, title: 'テストタスク', agentName: 'Developer Agent', provider: 'Anthropic', model: 'Claude Code', cost: 1.23 },
  });
  assert.equal(task.status, 201);
  assert.match(task.data.task.task_code, /^T-\d+$/);

  const taskList = await call('/api/tasks', { cookie });
  assert.ok(taskList.data.tasks.some((t) => t.id === task.data.task.id));

  const knowledge = await call('/api/knowledge', {
    method: 'POST', cookie, body: { title: 'テストKnowledge', type: 'Lesson', projectId, score: 80 },
  });
  assert.equal(knowledge.status, 201);
  assert.match(knowledge.data.knowledge.kc_code, /^KC-\d+$/);

  const promote = await call(`/api/knowledge/${knowledge.data.knowledge.id}`, {
    method: 'PATCH', cookie, body: { status: 'promoted' },
  });
  assert.equal(promote.status, 200);
  assert.equal(promote.data.knowledge.status, 'promoted');

  const usage = await call('/api/usage', { cookie });
  const anthropicRow = usage.data.usage.find((u) => u.provider === 'Anthropic');
  assert.ok(Number(anthropicRow.cost) >= 1.23);

  const verify = await call('/api/audit/verify', { cookie });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.ok, true);
  assert.deepEqual(verify.data.breaks, []);
  assert.ok(verify.data.count > 0);
});

test('Chat: メッセージ送信とルールベース応答がDBへ永続化される', async () => {
  await createUser('e2e-chat@example.com', 'E2E Chat', 'Viewer', 'chat-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-chat@example.com', 'chat-password'); // doc003-allow: 使い捨てテストDB専用の固定値

  const first = await call('/api/chat/conversations/me', { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.data.messages.length, 1); // 初回挨拶メッセージ

  const sent = await call('/api/chat/messages', { method: 'POST', cookie, body: { text: '現場写真の整理を自動化したい' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.role, 'ai');
  assert.equal(sent.data.message.idea_json.title, '現場写真の自動整理・台帳化');
  // テスト環境では LLM_PROVIDER/LLM_API_KEY を設定しないため、必ずルールベース応答になる。
  assert.equal(sent.data.message.source, 'scripted');

  const after = await call('/api/chat/conversations/me', { cookie });
  assert.equal(after.data.messages.length, 3); // 挨拶 + ユーザー発話 + AI応答
});

test('Users / Integrations / Agents / Router API', async () => {
  await createUser('e2e-admin4@example.com', 'E2E Admin4', 'Administrator', 'admin-password4'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-admin4@example.com', 'admin-password4'); // doc003-allow: 使い捨てテストDB専用の固定値

  const users = await call('/api/users', { cookie });
  assert.ok(users.data.users.some((u) => u.email === 'e2e-admin4@example.com'));

  await pool.query(
    `INSERT INTO integrations (id, name, role, status) VALUES ('notion', 'Notion', 'Knowledge SoR', 'attention')`,
  );
  const patched = await call('/api/integrations/notion', { method: 'PATCH', cookie, body: { status: 'connected', detail: '手動確認済み' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.integration.status, 'connected');

  await pool.query(`INSERT INTO model_router (category, model) VALUES ('Research / Classification', 'DeepSeek-V3')`);
  const routerPatch = await call('/api/router', {
    method: 'PATCH', cookie, body: { category: 'Research / Classification', model: 'Claude Opus' },
  });
  assert.equal(routerPatch.status, 200);
  assert.equal(routerPatch.data.router.model, 'Claude Opus');
});

test('ユーザーCRUD: 作成・PWリセット・無効化でログイン不可・最後のAdministratorは無効化不可', async () => {
  await createUser('e2e-admin5@example.com', 'E2E Admin5', 'Administrator', 'admin-password5'); // doc003-allow: 使い捨てテストDB専用の固定値
  const admin5Id = (await pool.query(`SELECT id FROM users WHERE email = 'e2e-admin5@example.com'`)).rows[0].id;
  const cookie = await loginAs('e2e-admin5@example.com', 'admin-password5'); // doc003-allow: 使い捨てテストDB専用の固定値

  // 作成: 初期パスワードが一度だけ返る
  const created = await call('/api/users', {
    method: 'POST', cookie, body: { email: 'e2e-newbie@example.com', name: 'E2E Newbie', role: 'Viewer', dept: '品質保証部' },
  });
  assert.equal(created.status, 201);
  assert.ok(created.data.initialPassword.length >= 16);
  const newbieId = created.data.user.id;

  // 作成直後の初期パスワードでログインできる
  const newbieCookie = await loginAs('e2e-newbie@example.com', created.data.initialPassword);
  const me = await call('/api/auth/me', { cookie: newbieCookie });
  assert.equal(me.data.user.email, 'e2e-newbie@example.com');

  // パスワード再発行後は旧パスワードでログインできない
  const reset = await call(`/api/users/${newbieId}/reset-password`, { method: 'POST', cookie });
  assert.equal(reset.status, 200);
  const oldLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'e2e-newbie@example.com', password: created.data.initialPassword } });
  assert.equal(oldLogin.status, 401);
  await loginAs('e2e-newbie@example.com', reset.data.newPassword); // 新パスワードでは成功する

  // 無効化するとログインできなくなる
  const deactivated = await call(`/api/users/${newbieId}`, { method: 'PATCH', cookie, body: { active: false } });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.data.user.active, false);
  const loginAfterDeactivate = await call('/api/auth/login', { method: 'POST', body: { email: 'e2e-newbie@example.com', password: reset.data.newPassword } });
  assert.equal(loginAfterDeactivate.status, 401);

  // 再度有効化すればログインできる
  await call(`/api/users/${newbieId}`, { method: 'PATCH', cookie, body: { active: true } });
  await loginAs('e2e-newbie@example.com', reset.data.newPassword);

  // 自分自身を無効化することはできない
  const selfDeactivate = await call(`/api/users/${admin5Id}`, { method: 'PATCH', cookie, body: { active: false } });
  assert.equal(selfDeactivate.status, 400);

  // 唯一の Administrator を Viewer へ降格することはできない。
  // 同一ファイル内の先行テストが作成した他の Administrator が残っているため、
  // ここで admin5 だけを有効な Administrator にしてから検証する。
  await pool.query(`UPDATE users SET active = false WHERE role = 'Administrator' AND id != $1`, [admin5Id]);
  const demoteOnlyAdmin = await call(`/api/users/${admin5Id}`, { method: 'PATCH', cookie, body: { role: 'Viewer' } });
  assert.equal(demoteOnlyAdmin.status, 400);

  // DELETE は論理削除（無効化）として扱われる
  const deleted = await call(`/api/users/${newbieId}`, { method: 'DELETE', cookie });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.user.active, false);
});

test('Dashboard 集約エンドポイント', async () => {
  await createUser('e2e-dash@example.com', 'E2E Dash', 'Viewer', 'dash-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const cookie = await loginAs('e2e-dash@example.com', 'dash-password'); // doc003-allow: 使い捨てテストDB専用の固定値

  const dash = await call('/api/dashboard', { cookie });
  assert.equal(dash.status, 200);
  assert.ok(typeof dash.data.kpis.totalProjects === 'number');
  assert.ok(Array.isArray(dash.data.pipeline));
  assert.ok(Array.isArray(dash.data.recentProjects));
});
