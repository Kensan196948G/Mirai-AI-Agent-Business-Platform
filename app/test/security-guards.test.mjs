/** F-31 CSRF ガード / F-32 レート制限 / F-34 テスト DB ガードのユニットテスト。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfGuard } from '../src/middleware/csrf.js';
import { consume, remaining, resetAll, rateLimitByIp, clientIp } from '../src/lib/rate-limit.js';
import { assertTestDatabaseUrl } from '../src/lib/test-db-guard.js';

function run(method, headers) {
  const req = { method, headers };
  let status = 200, body = null, nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  csrfGuard(req, res, () => { nexted = true; });
  return { status, body, nexted };
}

test('csrfGuard: 更新系で Origin が自ホストと不一致なら 403、一致・Origin 無し・GET は通す', () => {
  assert.equal(run('POST', { host: 'app.example', origin: 'https://evil.example' }).status, 403);
  assert.equal(run('PATCH', { host: 'app.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }).status, 403);
  assert.equal(run('POST', { host: 'app.example', origin: 'https://app.example' }).nexted, true);
  assert.equal(run('POST', { host: 'internal:18860', 'x-forwarded-host': 'app.example', origin: 'https://app.example' }).nexted, true, 'Cloudflare 経由は x-forwarded-host を使う');
  assert.equal(run('POST', { host: 'app.example' }).nexted, true, 'Origin 無し（curl / CLI）は Cookie が付かないため対象外');
  assert.equal(run('GET', { host: 'app.example', origin: 'https://evil.example' }).nexted, true);
  process.env.APP_ALLOWED_ORIGINS = 'https://alt.example';
  assert.equal(run('POST', { host: 'app.example', origin: 'https://alt.example' }).nexted, true, '許可リストの Origin は通す');
  delete process.env.APP_ALLOWED_ORIGINS;
});

test('rate-limit: 固定ウィンドウで limit を超えると false、remaining が減る。IP ミドルウェアは 429 を返す', () => {
  resetAll();
  const opt = { limit: 3, windowMs: 60_000 };
  assert.equal(consume('k', opt), true); assert.equal(consume('k', opt), true); assert.equal(consume('k', opt), true);
  assert.equal(consume('k', opt), false);
  assert.equal(remaining('k', opt), 0);
  assert.equal(consume('other', opt), true, 'キーごとに独立');
  let status = 200; const res = { status(s) { status = s; return this; }, json() { return this; }, setHeader() {} };
  const mw = rateLimitByIp('t', { limit: 1, windowMs: 60_000 });
  const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientIp(req), '203.0.113.5');
  let nexted = 0; mw(req, res, () => nexted++); mw(req, res, () => nexted++);
  assert.equal(nexted, 1); assert.equal(status, 429);
  resetAll();
});

test('test-db-guard: 本番 / MVP の DB 名と本番ロールを拒否し、テスト DB とテストロールだけ許可する', () => {
  assert.deepEqual(assertTestDatabaseUrl('postgres://mira_agent_os_test_app:x@127.0.0.1:5432/mira_agent_os_test'), { dbName: 'mira_agent_os_test', role: 'mira_agent_os_test_app' }); // doc003-allow: ダミー
  assert.ok(assertTestDatabaseUrl('postgres://mira_agent_os_test_app:x@h/mira_agent_os_test_ci')); // doc003-allow: ダミー
  assert.throws(() => assertTestDatabaseUrl('postgres://mira_agent_os_app:x@h/mira_agent_os'), /本番/); // doc003-allow: ダミー
  assert.throws(() => assertTestDatabaseUrl('postgres://mira_agent_os_test_app:x@h/mira_agent_os_mvp'), /本番/); // doc003-allow: ダミー
  assert.throws(() => assertTestDatabaseUrl('postgres://mira_agent_os_app:x@h/mira_agent_os_test'), /ロール/); // doc003-allow: ダミー
  assert.throws(() => assertTestDatabaseUrl('postgres://mira_agent_os_test_app:x@h/testing_db'), /DB 名/); // doc003-allow: ダミー
  assert.throws(() => assertTestDatabaseUrl(''), /DATABASE_URL/);
});
