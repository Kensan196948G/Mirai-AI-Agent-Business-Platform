/**
 * Agent Runtime（P0共通実行基盤 + P1 みらい建設Domain Pack）のE2E/統合テスト。
 * 実行前提・安全策は test/e2e.test.mjs と同じ（使い捨てテスト用DB必須）。
 *
 * テスト環境では LLM_PROVIDER/LLM_API_KEY を設定しないため、structured_llm系Skillは
 * 「LLM未設定」で明示的に失敗する（これ自体が意図した否定系テストの1つ）。
 * 決定的Skill（technology-catalog-search等）はLLM無しで完走することを確認する。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { app } from '../src/server.js';
import { hashPassword } from '../src/lib/auth.js';
import { syncAgent } from '../src/agent-runtime/registry.js';
import { executeNextStep } from '../src/agent-runtime/workflow-engine.js';
import { validateCitations } from '../src/agent-runtime/evidence-validator.js';
import { claimNextRun } from '../src/agent-runtime/job-store.js';
import { withTransaction } from '../src/lib/db.js';

/** Workerが実際に行うのと同じ手順（Lease取得 → Step実行）でテストからRunを進める。 */
async function claimAndExecute(runId) {
  await withTransaction((client) => claimNextRun(client, { workerId: 'test-worker', leaseSeconds: 60 }));
  return executeNextStep(runId, { workerId: 'test-worker' });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error('DATABASE_URL / SESSION_SECRET を使い捨てテスト用DBに設定してから実行すること');
}
if (!/test/.test(process.env.DATABASE_URL)) {
  throw new Error('安全のため DATABASE_URL に "test" を含む使い捨てDBのみ許可する');
}

const ALL_TABLES = [
  'worker_heartbeats', 'artifact_citations', 'artifacts', 'effect_ledger', 'budget_reservations', 'run_events', 'agent_runs',
  'source_records', 'agent_skill_bindings', 'skill_versions', 'agent_versions',
  'chat_messages', 'chat_conversations', 'task_tool_calls', 'tasks', 'knowledge_candidates',
  'approval_steps', 'approval_requests', 'project_kpis', 'projects', 'requests',
  'integrations', 'agents_config', 'skills_registry', 'model_router',
  'audit_log', 'users', 'schema_migrations',
];

let server;
let baseUrl;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let adminId;
let scopedProjectId;
let adminCookie;

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${ALL_TABLES.join(', ')} CASCADE`);
  const migrationsDir = join(__dirname, '..', 'migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const hash = await hashPassword('agent-runtime-test-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'Administrator',$3) RETURNING id`,
    ['agent-runtime-admin@example.com', 'Agent Runtime Admin', hash],
  );
  adminId = rows[0].id;

  // Domain Pack をDBへ同期する（本番運用ではsync-agent-registry.mjsをAdministratorが実行する）。
  await withTransaction(async (client) => {
    await syncAgent(client, 'mirai-construction', 'technology-selection', '1.0.0', { approvedByUserId: adminId, status: 'approved' });
    await syncAgent(client, 'mirai-construction', 'project-case-research', '1.0.0', { approvedByUserId: adminId, status: 'approved' });
    await syncAgent(client, 'mirai-construction', 'knowledge-quality', '1.0.0', { approvedByUserId: adminId, status: 'approved' });
  });

  // 案件越境テスト用に、実在するprojectを1件作る（project_scopeのFK制約を満たすため）。
  const { rows: reqForScope } = await pool.query(
    `INSERT INTO requests (request_code, title, description, requester_id) VALUES ('REQ-TEST-SCOPE','x','x',$1) RETURNING id`,
    [adminId],
  );
  const { rows: scopedProject } = await pool.query(
    `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id, status)
     VALUES ('AGENTOS-9999-0098', 'テスト案件（scope用）', 'x', $1, $2, $2, 'active') RETURNING id`,
    [reqForScope[0].id, adminId],
  );
  scopedProjectId = scopedProject[0].id;

  // 公開情報Fixtureを直接投入する（値は docs/Mirai-Agent-Skill-Architecture.md 確認済みの要約）。
  await pool.query(
    `INSERT INTO source_records (source_code, canonical_url, title, source_type, evidence_type, summary, content_hash, classification, status)
     VALUES
       ('SRC-TEST-01','https://www.mirai-const.co.jp/technology/port/3783/','MC-Wake','technology_catalog','marketing_overview',
        'MC-Wakeは公式サイトで公開されている港湾関連技術。警告記録の説明・確認事項の整理の参考にできる。','h1','public','approved'),
       ('SRC-TEST-03','https://www.mirai-const.co.jp/work/','海上施工実績サンプル','project_case','synthetic_fixture',
        '（合成Fixture）海上施工の一般的な実績カテゴリ例。個人情報・位置情報は含まない。','h3','public','approved')`,
  );
  await pool.query(
    `INSERT INTO source_records (source_code, canonical_url, title, source_type, evidence_type, summary, content_hash, classification, status, project_scope)
     VALUES ('SRC-TEST-02','https://example.com/internal','社内限定資料（テスト用）','technology_catalog','synthetic_fixture',
        '特定案件専用の非公開情報（テスト用）。','h2','internal_project','approved',$1)`,
    [scopedProjectId],
  );

  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'agent-runtime-admin@example.com', password: 'agent-runtime-test-password' } }); // doc003-allow: 使い捨てテストDB専用の固定値
  adminCookie = login.cookie.split(';')[0];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: setCookie };
}

async function createUser(email, name, role, password) {
  const hash = await hashPassword(password); // doc003-allow: 使い捨てテストDB専用の固定値
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, name, role, hash],
  );
  return rows[0].id;
}

async function loginAs(email, password) {
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `login failed for ${email}: ${JSON.stringify(login.data)}`);
  return login.cookie.split(';')[0];
}

test('Registry: syncAgentで登録した版が承認済みとして取得できる', async () => {
  const versions = await call('/api/skills/technology-catalog-search/versions', { cookie: adminCookie });
  assert.equal(versions.status, 200);
  assert.ok(versions.data.versions.some((v) => v.status === 'approved'));
});

test('Policy: Viewerロールは Agent Run を開始できない', async () => {
  await createUser('e2e-viewer-agent@example.com', 'E2E Viewer', 'Viewer', 'viewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const viewerCookie = await loginAs('e2e-viewer-agent@example.com', 'viewer-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: viewerCookie, body: { agentId: 'technology-selection', input: { query: 'MC-Wake' } },
  });
  assert.equal(created.status, 403);
});

test('縦断経路: technology-selection の決定的Stepは完走し、LLM未設定Stepで明示的に停止する', async () => {
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: 'MC-Wake について教えて' } },
  });
  assert.equal(created.status, 201);
  const runId = created.data.run.id;
  assert.equal(created.data.run.status, 'queued');

  // Step 1: technology-catalog-search（決定的、LLM不要）→ 完了するはず
  const step1 = await claimAndExecute(runId);
  assert.equal(step1.done, false);
  assert.equal(step1.run.current_step, 1);
  assert.equal(step1.run.status, 'running');

  const eventsAfterStep1 = await call(`/api/agent-runs/${runId}/events`, { cookie: adminCookie });
  const step1Completed = eventsAfterStep1.data.events.find((e) => e.type === 'step_completed' && e.skill_id === 'technology-catalog-search');
  assert.ok(step1Completed, 'step1の完了イベントが記録されていること');
  assert.ok(step1Completed.detail.candidates.some((c) => c.title === 'MC-Wake'), 'MC-Wakeが候補として見つかること');

  // Step 2: applicability-gap-check（structured_llm）→ LLM未設定のため明示的に失敗する
  const step2 = await claimAndExecute(runId);
  assert.equal(step2.done, true);
  assert.equal(step2.run.status, 'failed');
  assert.match(step2.run.error_message, /LLM未設定/);

  const finalEvents = await call(`/api/agent-runs/${runId}/events`, { cookie: adminCookie });
  const errorEvent = finalEvents.data.events.find((e) => e.type === 'error');
  assert.ok(errorEvent, 'エラーイベントが記録されていること');

  // 未設定・未接続・実行失敗を偽の成功にしない: artifactは作成されていないこと
  const runDetail = await call(`/api/agent-runs/${runId}`, { cookie: adminCookie });
  assert.equal(runDetail.data.artifacts.length, 0);
});

test('Policy: 案件越境（internal_projectの別案件参照）は拒否される', async () => {
  // scopedProjectId（SRC-TEST-02が属する案件）とは異なる案件IDを持つRunとして検証する。
  const runWithDifferentProject = { id: -1, project_id: scopedProjectId + 1 };
  const { rows } = await pool.query(`SELECT id FROM source_records WHERE source_code = 'SRC-TEST-02'`);
  const internalSourceId = rows[0].id;

  const result = await withTransaction((client) => validateCitations(client, {
    run: runWithDifferentProject, sources: [{ source_record_id: internalSourceId }],
  }));
  assert.equal(result.valid.length, 0);
  assert.equal(result.invalid.length, 1);
  assert.match(result.invalid[0].reason, /別案件|非公開/);
});

test('Policy: 未承認・無効化されたSkill版は実行時に拒否される', async () => {
  await pool.query(`UPDATE skill_versions SET status = 'deprecated' WHERE skill_id = 'technology-catalog-search'`);

  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: 'MC-Wake' } },
  });
  assert.equal(created.status, 201);

  const step = await claimAndExecute(created.data.run.id);
  assert.equal(step.done, true);
  assert.equal(step.run.status, 'failed');
  assert.match(step.run.error_message, /無効化/);

  // 後続テストへ影響しないよう復元する
  await pool.query(`UPDATE skill_versions SET status = 'approved' WHERE skill_id = 'technology-catalog-search'`);
});

test('Runtime偽装防止: source=runtimeのTaskはPATCH /api/tasks/:idから直接更新できない', async () => {
  const { rows: reqRows } = await pool.query(
    `INSERT INTO requests (request_code, title, description, requester_id) VALUES ('REQ-TEST-0099','x','x',$1) RETURNING id`,
    [adminId],
  );
  const { rows: projectRows } = await pool.query(
    `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id, status)
     VALUES ('AGENTOS-9999-0099', 'テスト案件2', 'x', $1, $2, $2, 'active') RETURNING id`,
    [reqRows[0].id, adminId],
  );
  const projectId = projectRows[0].id;

  const { rows: taskRows } = await pool.query(
    `INSERT INTO tasks (task_code, project_id, title, agent_name, provider, model, status, created_by, source)
     VALUES ('T-TEST-0001', $1, 'Runtime管理タスク', 'technology-selection', 'deepseek', 'deepseek-chat', 'running', $2, 'runtime')
     RETURNING id`,
    [projectId, adminId],
  );
  const taskId = taskRows[0].id;

  const patch = await call(`/api/tasks/${taskId}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'completed' } });
  assert.equal(patch.status, 409);
});

test('Artifact: アプリ内レビューは1回のみ許可され、二重レビューは拒否される', async () => {
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: 'テスト用artifact作成' } },
  });
  const runId = created.data.run.id;
  const { rows } = await pool.query(
    `INSERT INTO artifacts (artifact_code, run_id, kind, title, content, review_state)
     VALUES ('ART-TEST-0001', $1, 'test_kind', 'テスト成果物', '{"findings":[]}', 'draft') RETURNING id`,
    [runId],
  );
  const artifactId = rows[0].id;

  const reviewed = await call(`/api/artifacts/${artifactId}/review`, { method: 'POST', cookie: adminCookie, body: { note: '確認済み' } });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.artifact.review_state, 'reviewed');

  const doubleReview = await call(`/api/artifacts/${artifactId}/review`, { method: 'POST', cookie: adminCookie, body: {} });
  assert.equal(doubleReview.status, 409);
});

test('Run制御: cancel要求後はStepを実行せずcancelledへ遷移する', async () => {
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: 'キャンセルテスト' } },
  });
  const runId = created.data.run.id;

  const cancelled = await call(`/api/agent-runs/${runId}/cancel`, { method: 'POST', cookie: adminCookie });
  assert.equal(cancelled.status, 200);

  const step = await claimAndExecute(runId);
  assert.equal(step.done, true);
  assert.equal(step.run.status, 'cancelled');

  const events = await call(`/api/agent-runs/${runId}/events`, { cookie: adminCookie });
  assert.equal(events.data.events.length, 0, 'キャンセル済みRunはStepを実行しないこと');
});

test('Run制御: 他人のRunはキャンセルできない', async () => {
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: '他人キャンセルテスト' } },
  });
  const runId = created.data.run.id;

  await createUser('e2e-other-admin@example.com', 'E2E Other Admin', 'Reviewer', 'other-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const otherCookie = await loginAs('e2e-other-admin@example.com', 'other-password'); // doc003-allow: 使い捨てテストDB専用の固定値

  const cancelled = await call(`/api/agent-runs/${runId}/cancel`, { method: 'POST', cookie: otherCookie });
  assert.equal(cancelled.status, 403);
});

test('縦断経路: project-case-research の決定的Stepは完走し、LLM未設定Stepで明示的に停止する', async () => {
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'project-case-research', input: { query: '海上施工実績サンプル' } },
  });
  assert.equal(created.status, 201);
  const runId = created.data.run.id;

  // Step 1: project-case-search（決定的、LLM不要）→ 完了するはず
  const step1 = await claimAndExecute(runId);
  assert.equal(step1.done, false);
  assert.equal(step1.run.current_step, 1);

  const events = await call(`/api/agent-runs/${runId}/events`, { cookie: adminCookie });
  const step1Completed = events.data.events.find((e) => e.type === 'step_completed' && e.skill_id === 'project-case-search');
  assert.ok(step1Completed, 'project-case-searchの完了イベントが記録されていること');
  assert.ok(
    step1Completed.detail.candidates.some((c) => c.title === '海上施工実績サンプル'),
    '海上施工実績サンプルが候補として見つかること',
  );

  // Step 2: case-comparison（structured_llm）→ LLM未設定のため明示的に失敗する
  const step2 = await claimAndExecute(runId);
  assert.equal(step2.done, true);
  assert.equal(step2.run.status, 'failed');
  assert.match(step2.run.error_message, /LLM未設定/);
});

test('縦断経路: knowledge-quality はknowledge_candidatesを入力に受け取り、LLM未設定Stepで明示的に停止する', async () => {
  const { rows } = await pool.query(
    `INSERT INTO knowledge_candidates (kc_code, title, type, summary, source)
     VALUES ('KC-TEST-0001', 'テスト用Knowledge候補', 'Lesson', 'テスト用の要約文です。', 'unit-test')
     RETURNING id`,
  );
  // pg は BIGINT を文字列で返すため、JSON Schema（type: integer）に合わせて Number() へ正規化する
  const knowledgeCandidateId = Number(rows[0].id);

  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie,
    body: {
      agentId: 'knowledge-quality',
      input: { knowledge_candidate_id: knowledgeCandidateId, title: 'テスト用Knowledge候補', summary: 'テスト用の要約文です。', source: 'unit-test' },
    },
  });
  assert.equal(created.status, 201);
  const runId = created.data.run.id;

  // Step 1: knowledge-quality-review（structured_llm）→ LLM未設定のため明示的に失敗する
  // （knowledge-quality の3Skillは全てLLMを使うため、テスト環境では最初のStepで止まる想定どおりの挙動）
  const step1 = await claimAndExecute(runId);
  assert.equal(step1.done, true);
  assert.equal(step1.run.status, 'failed');
  assert.match(step1.run.error_message, /LLM未設定/);
});

test('Registry承認: draft同期の版は実行不可、Administratorの承認後に実行可能になる', async () => {
  // 別Agentを draft として再同期し、承認前後の挙動を確認する（他テストは approved 同期済みの版に依存するため
  // 内容ハッシュを変えない = 既存の approved 状態は維持される。ここでは新しい版番号ではなく status 遷移のみを検証）。
  await pool.query(`UPDATE agent_versions SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE agent_id = 'project-case-research'`);

  const catalog = await call('/api/agent-catalog', { cookie: adminCookie });
  assert.equal(catalog.status, 200);
  const pcr = catalog.data.agents.find((a) => a.agent_id === 'project-case-research');
  assert.ok(pcr, 'カタログに project-case-research が含まれること');
  assert.equal(pcr.runnable, false, 'draft の Agent 版は runnable=false');
  assert.ok(pcr.purpose.length > 0 && pcr.does_not.length > 0, '用途・できないことが返ること');

  // 未承認版では Run を開始できない（承認済み版が無い）
  const blocked = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'project-case-research', input: { query: 'x' } },
  });
  assert.equal(blocked.status, 409);

  // Viewer/Reviewer は承認できない
  const reviewerCookie = await loginAs('e2e-other-admin@example.com', 'other-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  const versions = await call('/api/agent-catalog/versions', { cookie: adminCookie });
  const draftAgent = versions.data.agents.find((v) => v.name === 'project-case-research');
  assert.equal(draftAgent.status, 'draft');
  const denied = await call(`/api/agent-catalog/versions/agent/${draftAgent.id}/approve`, { method: 'POST', cookie: reviewerCookie });
  assert.equal(denied.status, 403);

  // Administrator が承認 → runnable になり Run を開始できる
  const approved = await call(`/api/agent-catalog/versions/agent/${draftAgent.id}/approve`, { method: 'POST', cookie: adminCookie });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.version.status, 'approved');
  const again = await call(`/api/agent-catalog/versions/agent/${draftAgent.id}/approve`, { method: 'POST', cookie: adminCookie });
  assert.equal(again.status, 409, '二重承認は拒否される');

  const catalog2 = await call('/api/agent-catalog', { cookie: adminCookie });
  assert.equal(catalog2.data.agents.find((a) => a.agent_id === 'project-case-research').runnable, true);
  const ok = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'project-case-research', input: { query: 'x' } },
  });
  assert.equal(ok.status, 201);

  // 承認取消（deprecate）→ 実行不可に戻る。監査ログに記録される
  const dep = await call(`/api/agent-catalog/versions/agent/${draftAgent.id}/deprecate`, { method: 'POST', cookie: adminCookie });
  assert.equal(dep.status, 200);
  const blocked2 = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'project-case-research', input: { query: 'x' } },
  });
  assert.equal(blocked2.status, 409);
  const { rows: audit } = await pool.query(`SELECT action FROM audit_log WHERE action IN ('agent_version.approve','agent_version.deprecate') ORDER BY id`);
  assert.deepEqual(audit.map((r) => r.action), ['agent_version.approve', 'agent_version.deprecate']);
});

test('Registry同期: 内容ハッシュが変わらない再同期は承認状態を維持し、draft同期でも承認を取り消さない', async () => {
  const before = await pool.query(`SELECT status FROM agent_versions WHERE agent_id = 'technology-selection'`);
  assert.equal(before.rows[0].status, 'approved');
  await withTransaction((client) => syncAgent(client, 'mirai-construction', 'technology-selection', '1.0.0', { approvedByUserId: adminId }));
  const after = await pool.query(`SELECT status FROM agent_versions WHERE agent_id = 'technology-selection'`);
  assert.equal(after.rows[0].status, 'approved', '同一ハッシュの draft 再同期で承認が失われないこと');
});

test('副作用の冪等性: artifact.write-draft は同一Run・同一kindで重複作成せず、レビュー済みは上書きしない', async () => {
  const { callTool } = await import('../src/agent-runtime/tool-gateway.js');
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: '冪等性テスト' } },
  });
  const runId = created.data.run.id;
  const { rows: sv } = await pool.query(`SELECT * FROM skill_versions WHERE skill_id = 'evidence-backed-draft' LIMIT 1`);
  const run = { id: runId, run_code: created.data.run.run_code, project_id: null };
  const args = { kind: 'evidence_backed_draft', title: 't', content: { findings: ['a'], sources: [], unknowns: [], assumptions: [], requires_human_review: true } };

  const first = await withTransaction((client) => callTool(client, { run, skillVersion: sv[0], toolName: 'artifact.write-draft', args }));
  const second = await withTransaction((client) => callTool(client, { run, skillVersion: sv[0], toolName: 'artifact.write-draft', args: { ...args, title: 't2' } }));
  assert.equal(first.artifact.reused, false);
  assert.equal(second.artifact.reused, true);
  assert.equal(second.artifact.id, first.artifact.id, '再試行で同じ artifact が再利用されること');
  const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM artifacts WHERE run_id = $1`, [runId]);
  assert.equal(count[0].n, 1, '同一Run・同一kindの草案は1件のみ');
  const { rows: titled } = await pool.query(`SELECT title FROM artifacts WHERE id = $1`, [first.artifact.id]);
  assert.equal(titled[0].title, 't2', '内容は最新の試行で更新される');

  // レビュー済みの草案は上書きされない
  await call(`/api/artifacts/${first.artifact.id}/review`, { method: 'POST', cookie: adminCookie, body: { note: 'ok' } });
  await assert.rejects(
    withTransaction((client) => callTool(client, { run, skillVersion: sv[0], toolName: 'artifact.write-draft', args: { ...args, title: 't3' } })),
    /レビュー済み/,
  );
});

test('月次上限: AI相談と業務Agent Runの利用額が合算される', async () => {
  const { currentMonthSpend } = await import('../src/lib/llm.js');
  const before = await withTransaction((client) => currentMonthSpend(client));
  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: '合算テスト' } },
  });
  await pool.query(`UPDATE budget_reservations SET spent_usd = spent_usd + 0.25 WHERE run_id = $1`, [created.data.run.id]);
  const after = await withTransaction((client) => currentMonthSpend(client));
  assert.ok(Math.abs(after - before - 0.25) < 1e-6, `Run の利用額 0.25 が合算されること（before=${before}, after=${after}）`);
});

test('evidence-backed-draft: 実DBで草案を保存した戻り値が output schema に適合する（artifact_id は integer）', async () => {
  const Ajv = (await import('ajv')).default;
  const { SKILL_HANDLERS } = await import('../src/agent-runtime/skills/index.js');
  const { loadSkillDefinition } = await import('../src/agent-runtime/skill-loader.js');
  const { callTool } = await import('../src/agent-runtime/tool-gateway.js');
  const { validateCitations } = await import('../src/agent-runtime/evidence-validator.js');

  const created = await call('/api/agent-runs', {
    method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: '草案戻り値テスト' } },
  });
  const run = { id: created.data.run.id, run_code: created.data.run.run_code, project_id: null };
  const { rows: sv } = await pool.query(`SELECT * FROM skill_versions WHERE skill_id = 'evidence-backed-draft' LIMIT 1`);
  const def = loadSkillDefinition('mirai-construction', 'evidence-backed-draft', '1.0.0');

  // 情報不足（比較表・根拠なし）の入力 → LLM を呼ばず「保留の草案」を実DBへ保存する決定的経路
  const output = await withTransaction((client) => SKILL_HANDLERS['evidence-backed-draft']({
    client, run, agentVersion: { version: '1.0.0' }, skillDef: def, skillVersion: sv[0],
    allSkillVersions: [{ skill_id: 'evidence-backed-draft', version: '1.0.0' }],
    input: { comparison_table: [], gaps: [], unknowns: ['情報不足'], assumptions: [] },
    callTool: (toolName, args) => callTool(client, { run, skillVersion: sv[0], toolName, args }),
    validateCitations: (sources) => validateCitations(client, { run, sources }),
    structuredComplete: async () => { throw new Error('この経路では LLM を呼ばない'); },
  }));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(def.outputSchema);
  assert.ok(validate(output), `output schema 不適合: ${new Ajv().errorsText(validate.errors)}`);
  assert.equal(typeof output.artifact_id, 'number', 'pg の BIGINT 文字列が Number に正規化されていること');
  assert.equal(output.requires_human_review, true);
  const { rows: art } = await pool.query(`SELECT id, review_state FROM artifacts WHERE run_id = $1`, [run.id]);
  assert.equal(art.length, 1);
  assert.equal(Number(art[0].id), output.artifact_id);
});

test('監視: /api/health が Worker 生存・キュー滞留・degraded を返し、ハートビート有無で判定が変わる', async () => {
  const before = await call('/api/health');
  assert.equal(before.status, 200);
  assert.equal(before.data.status, 'ok');
  assert.equal(before.data.worker.alive, false, 'Worker 未起動のテスト環境では alive=false');
  assert.ok(Array.isArray(before.data.degraded) && before.data.degraded.some((m) => /Worker/.test(m)));

  await pool.query(`INSERT INTO worker_heartbeats (worker_id, hostname, pid) VALUES ('test-worker-1', 'ci', 1)`);
  const after = await call('/api/health');
  assert.equal(after.data.worker.alive, true);
  assert.equal(after.data.worker.alive_count, 1);
  assert.ok(!after.data.degraded.some((m) => /Worker/.test(m)));

  // 古いハートビートは alive と見なさない
  await pool.query(`UPDATE worker_heartbeats SET last_seen_at = now() - interval '10 minutes' WHERE worker_id = 'test-worker-1'`);
  const stale = await call('/api/health');
  assert.equal(stale.data.worker.alive, false);

  // queued の滞留は degraded に現れる（閾値を過去に倒して検証）
  const created = await call('/api/agent-runs', { method: 'POST', cookie: adminCookie, body: { agentId: 'technology-selection', input: { query: '滞留テスト' } } });
  await pool.query(`UPDATE agent_runs SET created_at = now() - interval '30 minutes' WHERE id = $1`, [created.data.run.id]);
  const backlog = await call('/api/health');
  assert.equal(backlog.data.queue.backlog, true);
  assert.ok(backlog.data.degraded.some((m) => /滞留/.test(m)));
  await pool.query(`UPDATE agent_runs SET status = 'cancelled', finished_at = now() WHERE id = $1`, [created.data.run.id]);
});
