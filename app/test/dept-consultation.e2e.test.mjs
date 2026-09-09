/**
 * 相談の流れ（1 相談を入力 → 2 AIが追加質問で整理 → 3 Idea構造化（DBに記録）→
 * 4 正式案件化（Project ID発番）→ 5 企画審査Gateで承認）を、みらい建設工業の
 * 組織部署 01〜09 それぞれについて実行し、全部署で企画審査Gate承認まで到達することを確認する。
 *
 * 実行前提・安全策は test/e2e.test.mjs と同じ（使い捨てテスト用DB必須）。
 * LLM は未設定（test:e2e）のためルールベース応答・語の一致による部署/近い Agent 判定を検証する。
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
  'orchestration_steps', 'orchestrations', 'artifact_checks', 'skill_evaluations', 'artifact_revisions', 'worker_heartbeats', 'artifact_citations', 'artifacts', 'effect_ledger', 'budget_reservations', 'run_events', 'agent_runs',
  'source_records', 'agent_skill_bindings', 'skill_versions', 'agent_versions',
  'chat_messages', 'chat_conversations', 'task_tool_calls', 'tasks', 'knowledge_candidates',
  'approval_steps', 'approval_requests', 'project_kpis', 'projects', 'requests',
  'integrations', 'agents_config', 'skills_registry', 'model_router',
  'audit_anchors', 'audit_log', 'users', 'schema_migrations',
];

let server;
let baseUrl;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let staffCookie;
let approverCookie;

before(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${ALL_TABLES.join(', ')} CASCADE`);
  const migrationsDir = join(__dirname, '..', 'migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createUser('dept-e2e-staff@example.com', 'E2E 部署担当', 'Administrator', 'dept-e2e-staff-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  await createUser('dept-e2e-approver@example.com', 'E2E 企画審査Gate承認者', 'Administrator', 'dept-e2e-approver-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  staffCookie = await loginAs('dept-e2e-staff@example.com', 'dept-e2e-staff-password'); // doc003-allow: 使い捨てテストDB専用の固定値
  approverCookie = await loginAs('dept-e2e-approver@example.com', 'dept-e2e-approver-password'); // doc003-allow: 使い捨てテストDB専用の固定値
});

async function createUser(email, name, role, password) {
  const hash = await hashPassword(password);
  await pool.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4)`, [email, name, role, hash]);
}

async function loginAs(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// みらい建設工業 9 組織それぞれの相談文。org-map.yaml の keywords に基づき、他部署の語と極力重複しないよう選定した
// （語の一致で決定的に部署・近い Agent が判定されることを確認するため）。
const DEPARTMENTS = [
  { code: '01', dept: '経営・統治・委員会', agent: 'governance-support', text: '取締役会向けに来月の委員会でガバナンスと内部統制の状況を報告したい' },
  { code: '02', dept: '営業・案件形成', agent: 'sales-opportunity-support', text: '新規顧客への提案のために、過去の入札実績を整理したい' },
  { code: '03', dept: '施工・調達・作業所', agent: 'construction-planning-support', text: '港湾の防波堤工事について、施工計画と資材調達の現場工程を整理したい' },
  { code: '04', dept: '技術・研究開発', agent: 'research-technology-support', text: '軟弱地盤の液状化対策について、工法を比較して技術選定を進めたい' },
  { code: '05', dept: '安全・品質・環境', agent: 'safety-quality-environment-review', text: '安全・品質・環境の観点で、基準に沿ったレビューと検査を行い、是正が必要な点を整理したい' },
  { code: '06', dept: '管理本部・経営企画', agent: 'management-planning-support', text: '管理本部向けにKPIの成果測定とヘルプデスクの問い合わせ状況を整理したい' },
  { code: '07', dept: '支店・営業支店・営業所', agent: 'branch-support', text: '北海道支店の地域における案件の状況を整理したい' },
  { code: '08', dept: '船舶事業部', agent: 'vessel-operation-support', text: '船舶事業の作業船運用と係留状況を整理したい' },
  { code: '09', dept: 'DX推進部', agent: 'external-dx-support', text: 'DX推進の一環でSlackとNotionのデータ連携システムを自動化したい' },
];

for (const d of DEPARTMENTS) {
  test(`相談の流れ（${d.code} ${d.dept}）: 相談入力 → AI追加質問 → Idea構造化（DB記録）→ 正式案件化 → 企画審査Gate承認`, async () => {
    // 1. 相談を入力（未認証は拒否）
    const unauth = await call('/api/chat/messages', { method: 'POST', body: { text: d.text } });
    assert.equal(unauth.status, 401);

    const sent = await call('/api/chat/messages', { method: 'POST', cookie: staffCookie, body: { text: d.text } });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    const message = sent.data.message;

    // 2. AIが追加質問で整理（LLM未設定のためルールベース応答。確認事項を含む）
    assert.equal(message.role, 'ai');
    assert.equal(message.source, 'scripted', 'テスト環境は LLM 未設定のためルールベース応答');
    assert.ok(typeof message.text === 'string' && message.text.length > 10, 'AIの追加質問テキストが返る');
    assert.match(message.text, /[？?]|確認/, 'AIが確認・追加質問を行う');

    // 3. Idea構造化（DBに記録）— 部署とAI相談から探る近いAgentが該当組織であることを確認
    const idea = message.idea_json;
    assert.ok(idea, 'idea_json が記録されている');
    assert.equal(idea.source, 'scripted');
    assert.deepEqual(idea.departments, [d.code], `関係部署が ${d.code}（${d.dept}）と判定される`);
    assert.ok(Array.isArray(idea.agents) && idea.agents.length > 0, '近い Agent が提示される');
    // 近い Agent は語の一致でスコアが高い順に最大 3 件（同じ部署内で最も具体的な Agent が上位に来ることがある）。
    // 部署（org_code）としての正しさを検証する。組織責務 Agent 自体は統合カタログに存在することだけ確認する。
    assert.ok(idea.agents.some((a) => a.org_code === d.code), `近い Agent が ${d.dept} 所属である（${JSON.stringify(idea.agents)}）`);
    const orgAgentCatalog = await call('/api/agent-catalog/org', { cookie: staffCookie });
    const orgAgent = orgAgentCatalog.data.agents.find((a) => a.agent_id === d.agent);
    assert.ok(orgAgent && orgAgent.org_code === d.code, `組織責務 Agent（${d.agent}）が ${d.dept} として統合カタログに存在する`);
    // 会話に記録済みであること（ブラウザを変えても同じ内容が見えることの根拠）
    const persisted = (await pool.query(`SELECT idea_json FROM chat_messages WHERE id = (SELECT max(id) FROM chat_messages)`)).rows[0];
    assert.deepEqual(persisted.idea_json.departments, [d.code]);

    // 4. 正式案件化（Project ID発番）
    const title = `${d.dept} 相談案件（E2E）`;
    const reqCreated = await call('/api/requests', { method: 'POST', cookie: staffCookie, body: { title, description: idea.target_task || d.text } });
    assert.equal(reqCreated.status, 201);
    assert.match(reqCreated.data.request.request_code, /^REQ-\d{4}-\d{4}$/);

    const promoted = await call(`/api/requests/${reqCreated.data.request.id}/promote`, { method: 'POST', cookie: staffCookie });
    assert.equal(promoted.status, 201, JSON.stringify(promoted.data));
    assert.match(promoted.data.project.project_code, /^AGENTOS-\d{4}-\d{4}$/, 'Project ID が発番される');
    assert.equal(promoted.data.project.status, 'idea');
    const projectId = promoted.data.project.id;

    // idea → proposed（審査へ提出。低リスクのため即時反映）
    const t1 = await call(`/api/projects/${projectId}/transition`, { method: 'POST', cookie: staffCookie, body: { to: 'proposed' } });
    assert.equal(t1.status, 200, JSON.stringify(t1.data));
    assert.equal(t1.data.project.status, 'proposed');

    // 5. 企画審査Gateで承認（project_gate。Approver 1段。申請者本人は判定できない＝SoD）
    const t2 = await call(`/api/projects/${projectId}/transition`, { method: 'POST', cookie: staffCookie, body: { to: 'approved' } });
    assert.equal(t2.status, 200, JSON.stringify(t2.data));
    assert.ok(t2.data.pending_approval, '企画審査Gateの承認申請が作られる');
    assert.match(t2.data.pending_approval.approval_code, /^APR-\d+$/);
    const approvalId = t2.data.pending_approval.id;

    const stillProposed = await call(`/api/projects/${projectId}`, { cookie: staffCookie });
    assert.equal(stillProposed.data.project.status, 'proposed', '承認確定までは status を変えない');

    const detail = await call(`/api/approvals/${approvalId}`, { cookie: staffCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.steps.length, 1);
    assert.equal(detail.data.steps[0].role, 'Approver');
    const stepId = detail.data.steps[0].id;

    // 申請者本人（staff）は自分の申請を判定できない
    const selfDecide = await call(`/api/approvals/${approvalId}/steps/${stepId}/decide`, { method: 'POST', cookie: staffCookie, body: { decision: 'approved', reason: '自己承認テスト' } });
    assert.equal(selfDecide.status, 403);

    const decided = await call(`/api/approvals/${approvalId}/steps/${stepId}/decide`, { method: 'POST', cookie: approverCookie, body: { decision: 'approved', reason: `${d.dept} の企画審査Gate承認（E2E）` } });
    assert.equal(decided.status, 200, JSON.stringify(decided.data));
    assert.equal(decided.data.status, 'approved');
    assert.equal(decided.data.project_status, 'approved');

    const afterApproval = await call(`/api/projects/${projectId}`, { cookie: staffCookie });
    assert.equal(afterApproval.data.project.status, 'approved', `${d.dept} の案件が企画審査Gateで承認され approved に到達`);

    // Audit: 部署ごとの一連の操作（案件昇格・状態遷移・企画審査Gate承認）が監査ログに残ることを確認（誰が・いつ・何をしたか）
    const { rows: projectAudit } = await pool.query(
      `SELECT action FROM audit_log WHERE resource_type = 'project' AND resource_id = $1 ORDER BY id`,
      [projectId],
    );
    assert.deepEqual(projectAudit.map((r) => r.action), ['request.promote', 'project.transition', 'project.transition_requested']);
    const { rows: approvalAudit } = await pool.query(
      `SELECT action, detail FROM audit_log WHERE resource_type = 'approval' AND resource_id = $1 ORDER BY id`,
      [approvalId],
    );
    assert.equal(approvalAudit.length, 1);
    assert.equal(approvalAudit[0].action, 'approval.approved');
    assert.equal(approvalAudit[0].detail.target_status, 'approved');
  });
}
