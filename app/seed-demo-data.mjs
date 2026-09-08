#!/usr/bin/env node
// WebUI 正本（agentos-data.js の seed()）が持つデモデータを実 PostgreSQL へ投入する。
// 冪等: 既に DX-2026-0042 が存在する場合は何もしない。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { hashPassword } from './src/lib/auth.js';
import { recordAudit } from './src/lib/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '.env'));

const USERS = [
  { key: 'u1', email: 'yamada@example.com', name: '山田 太郎', dept: '経営企画部', role: 'Approver' },
  { key: 'u2', email: 'sato@example.com', name: '佐藤 花子', dept: '情報システム部', role: 'Administrator' },
  { key: 'u3', email: 'suzuki@example.com', name: '鈴木 一郎', dept: '土木技術部', role: 'Developer' },
  { key: 'u4', email: 'takahashi@example.com', name: '高橋 美咲', dept: '技術研究所', role: 'Reviewer' },
  { key: 'u5', email: 'ito@example.com', name: '伊藤 健', dept: 'DX推進室', role: 'Knowledge Curator' },
  { key: 'u6', email: 'watanabe@example.com', name: '渡辺 直子', dept: '東京支店 工事部', role: 'Viewer' },
];

const PROJECTS = [
  { key: 'DX-2026-0042', title: '現場写真の自動整理・台帳化', status: 'active', owner: 'u3', risk: 'R3',
    summary: 'EXIF・電子黒板情報から工種を分類し、工事写真台帳を自動生成する。', repo: 'mirai/agentos-photo-ledger',
    kpis: [{ name: '写真整理工数', target: 60, current: 38, unit: '%削減' }, { name: '分類精度', target: 95, current: 91, unit: '%' }] },
  { key: 'DX-2026-0038', title: '工事日報・報告書の自動生成', status: 'staging', owner: 'u3', risk: 'R3',
    summary: '作業実績・天候・人員から日報を生成し、発注者書式へ出力する。', repo: 'mirai/agentos-report-gen',
    kpis: [{ name: '作成時間', target: 70, current: 64, unit: '%削減' }, { name: '記載漏れ', target: 0, current: 2, unit: '件/月' }] },
  { key: 'DX-2026-0045', title: '出来形検査データのAI照査', status: 'approved', owner: 'u4', risk: 'R3',
    summary: '出来形測定値を基準値と自動照査し、逸脱候補を提示する。', repo: 'mirai/agentos-inspection-check',
    kpis: [{ name: '照査時間', target: 50, current: 0, unit: '%削減' }] },
  { key: 'DX-2026-0047', title: '安全巡視記録の音声入力化', status: 'proposed', owner: 'u6', risk: 'R2',
    summary: '巡視中の音声メモを文字化し、是正指示書へ構造化する。', repo: null,
    kpis: [{ name: '記録時間', target: 40, current: 0, unit: '%削減' }] },
  { key: 'DX-2026-0051', title: '積算根拠資料のRAG検索', status: 'idea', owner: 'u1', risk: 'R1',
    summary: '過去の積算根拠・見積資料を横断検索し、根拠提示を高速化する。', repo: null, kpis: [] },
  { key: 'DX-2026-0031', title: 'コンクリート試験成績の自動判定', status: 'production', owner: 'u4', risk: 'R3',
    summary: '圧縮強度・スランプ試験結果を規格値と照合し、合否を自動判定する。', repo: 'mirai/agentos-concrete-qc',
    kpis: [{ name: '判定工数', target: 50, current: 58, unit: '%削減' }, { name: '誤判定', target: 0, current: 0, unit: '件' }] },
  { key: 'DX-2026-0040', title: 'ドローン測量点群の差分抽出', status: 'suspended', owner: 'u3', risk: 'R2',
    summary: '施工前後の点群差分から土量変化を抽出する。', repo: 'mirai/agentos-pointcloud-diff',
    kpis: [{ name: '土量算出時間', target: 60, current: 12, unit: '%削減' }] },
  { key: 'DX-2026-0022', title: '施工計画書テンプレート整備', status: 'closed', owner: 'u1', risk: 'R1',
    summary: '施工計画書の標準テンプレートと記載ガイドを整備した。', repo: 'mirai/docs-templates',
    kpis: [{ name: '作成時間', target: 30, current: 34, unit: '%削減' }] },
];

const TASKS = [
  { code: 'T-1021', pk: 'DX-2026-0042', title: 'EXIF/黒板情報からの工種分類モデル実装', agent: 'Developer Agent', provider: 'Anthropic', model: 'Claude Code', status: 'running', tin: 184200, tout: 42100, cost: 1.82, lat: 48200, tools: [['notion.search', 'R0', 'PERMIT'], ['github.create_branch', 'R1', 'PERMIT'], ['github.push', 'R2', 'PERMIT']] },
  { code: 'T-1020', pk: 'DX-2026-0042', title: '分類精度テスト生成（Unit / Integration）', agent: 'Developer Agent', provider: 'OpenAI', model: 'Codex', status: 'completed', tin: 96400, tout: 31800, cost: 0.94, lat: 31500, tools: [['github.push', 'R2', 'PERMIT'], ['ci.run_tests', 'R1', 'PERMIT']] },
  { code: 'T-1019', pk: 'DX-2026-0042', title: 'PR #48 独立レビュー（実装モデルと分離）', agent: 'Reviewer Agent', provider: 'DeepSeek', model: 'DeepSeek-V3', status: 'review', tin: 142000, tout: 9800, cost: 0.11, lat: 22400, tools: [['github.read_pr', 'R0', 'PERMIT'], ['github.comment', 'R1', 'PERMIT']] },
  { code: 'T-1018', pk: 'DX-2026-0038', title: '本番リリース手順書・Rollback案作成', agent: 'Operations Agent', provider: 'Anthropic', model: 'Claude Sonnet', status: 'blocked', tin: 38200, tout: 12600, cost: 0.31, lat: 15200, tools: [['notion.read', 'R0', 'PERMIT'], ['deploy.production', 'R4', 'APPROVAL_REQUIRED']] },
  { code: 'T-1017', pk: 'DX-2026-0045', title: '出来形基準値（土木工事施工管理基準）の調査・比較', agent: 'Research Agent', provider: 'DeepSeek', model: 'DeepSeek-V3', status: 'completed', tin: 210000, tout: 18400, cost: 0.16, lat: 41000, tools: [['web.search', 'R0', 'PERMIT'], ['notion.search', 'R0', 'PERMIT']] },
  { code: 'T-1016', pk: 'DX-2026-0045', title: 'ADR: 照査ロジックの配置（Worker vs API）', agent: 'Architecture Agent', provider: 'Anthropic', model: 'Claude Opus', status: 'completed', tin: 54000, tout: 9200, cost: 1.5, lat: 27800, tools: [['notion.read', 'R0', 'PERMIT'], ['notion.draft', 'R1', 'PERMIT']] },
  { code: 'T-1015', pk: 'DX-2026-0047', title: 'Intent分類・Risk候補判定', agent: 'CTO Orchestrator', provider: 'DeepSeek', model: 'DeepSeek-V3', status: 'completed', tin: 6200, tout: 1400, cost: 0.01, lat: 3200, tools: [['notion.search', 'R0', 'PERMIT']] },
  { code: 'T-1014', pk: 'DX-2026-0038', title: '帳票テンプレート差分適用', agent: 'Developer Agent', provider: 'OpenAI', model: 'Codex', status: 'failed', tin: 44000, tout: 12000, cost: 0.42, lat: 19800, err: 'Validation Error: テンプレート schema 不一致（Retry対象外 → Failed）', tools: [['github.push', 'R2', 'PERMIT'], ['schema.validate', 'R0', 'PERMIT']] },
  { code: 'T-1013', pk: 'DX-2026-0031', title: 'Lessons Learned 抽出（Knowledge候補生成）', agent: 'Knowledge Curator', provider: 'Anthropic', model: 'Claude Sonnet', status: 'completed', tin: 72000, tout: 8800, cost: 0.35, lat: 12600, tools: [['notion.search', 'R0', 'PERMIT'], ['knowledge.candidate', 'R1', 'PERMIT']] },
  { code: 'T-1012', pk: 'DX-2026-0040', title: '点群差分アルゴリズム調査', agent: 'Research Agent', provider: 'DeepSeek', model: 'DeepSeek-V3', status: 'cancelled', tin: 18000, tout: 2100, cost: 0.02, lat: 8000, tools: [['web.search', 'R0', 'PERMIT']] },
];

const APPROVALS = [
  { code: 'APR-0107', pk: 'DX-2026-0038', type: 'production_release', risk: 'R4', target: '本番リリース承認（v0.9.0）/ GitHub Release v0.9.0', status: 'pending',
    steps: [{ role: 'Reviewer', who: 'u4', status: 'approved' }, { role: 'Approver', who: 'u1', status: 'pending' }] },
  { code: 'APR-0108', pk: 'DX-2026-0042', type: 'github_merge', risk: 'R3', target: 'PR #48 main へのMerge', status: 'pending',
    steps: [{ role: 'Reviewer', who: 'u4', status: 'pending' }, { role: 'Approver', who: 'u1', status: 'pending' }] },
  { code: 'APR-0106', pk: 'DX-2026-0047', type: 'project_gate', risk: 'R2', target: '正式案件化（企画審査Gate）', status: 'pending',
    steps: [{ role: 'Approver', who: 'u1', status: 'pending' }] },
  { code: 'APR-0104', pk: 'DX-2026-0045', type: 'project_gate', risk: 'R2', target: '正式案件化（企画審査Gate）', status: 'approved',
    steps: [{ role: 'Approver', who: 'u1', status: 'approved', reason: '効果・実現性ともに妥当。MVPは1工区に限定。' }] },
  { code: 'APR-0099', pk: 'DX-2026-0040', type: 'budget', risk: 'R3', target: '追加予算（点群処理GPU）', status: 'rejected',
    steps: [{ role: 'Approver', who: 'u1', status: 'rejected', reason: 'クラウドGPUのスポット利用で代替可能。案件は保留。' }] },
];

const KNOWLEDGE = [
  { code: 'KC-0311', title: '現場写真のEXIF欠損時は電子黒板OCRの日付を優先する', type: 'Lesson', pk: 'DX-2026-0042', score: 82, status: 'pending', summary: '撮影機材によりEXIF撮影日時が欠損する事例が全体の12%。黒板OCRの日付を優先し、矛盾時はHuman Reviewへ回す運用が有効だった。', source: 'Agent Run T-1020 / PR #48 レビューコメント' },
  { code: 'KC-0310', title: 'ADR: 出来形照査ロジックはWorker側に配置する', type: 'ADR', pk: 'DX-2026-0045', score: 91, status: 'pending', summary: '長時間処理となる照査計算はAPIから分離しWorkerで実行、Job IDで非同期化する。', source: 'Agent Run T-1016（Architecture Agent）' },
  { code: 'KC-0309', title: '帳票テンプレート差分は schema version で管理する', type: 'Playbook', pk: 'DX-2026-0038', score: 64, status: 'pending', summary: '発注者書式変更に対し、テンプレートへschema versionを付与しValidationで不一致を検出する。', source: 'Agent Run T-1014（Failed）のPostmortem' },
  { code: 'KC-0305', title: 'コンクリート試験成績の閾値判定パラメータ', type: 'Standard', pk: 'DX-2026-0031', score: 88, status: 'promoted', summary: '圧縮強度・スランプの規格値と許容差、判定ロジックの確定版。', source: 'Agent Run T-1013', notionRef: 'notion://knowledge/standards/KC-0305' },
  { code: 'KC-0302', title: 'Slack #dx-0040 議論ログ（生データ）', type: 'Raw', pk: 'DX-2026-0040', score: 21, status: 'rejected', summary: '点群処理に関するSlackスレッドの全文。', source: 'Slack Raw Conversation' },
];

const INTEGRATIONS = [
  { id: 'notion', name: 'Notion', role: 'Knowledge SoR', status: 'connected', detail: 'Knowledge DB 3 / Pages 412 / 発見候補DB 同期', note: '必要範囲のみ取得。Secretは書き込まない' },
  { id: 'slack', name: 'Slack', role: 'Collaboration', status: 'connected', detail: '#dx-0042 ほか 6ch / Approval Prompt 有効', note: 'Raw LogはKnowledge化しない（FR-303）' },
  { id: 'gmail', name: 'Gmail', role: 'Mail Gateway', status: 'attention', detail: '受信 14 / 自動返信 9 / Human Review待ち 2', note: '契約・金額・機密・承認事項は自動返信禁止（SEC-006）' },
  { id: 'github', name: 'GitHub', role: 'Engineering SoR', status: 'connected', detail: 'Repos 6 / Open PR 4 / Webhook 128 events', note: 'Merge / Release は Policy 対象' },
];

const AGENTS = [
  { id: 'cto', name: 'CTO Orchestrator', duty: 'Goal解釈、Plan、委譲、結果統合', skills: 'planning, delegation, risk-classification', model: 'Claude Opus', enabled: true },
  { id: 'research', name: 'Research Agent', duty: '調査、比較、根拠収集', skills: 'web-research, notion-search, repo-analysis', model: 'DeepSeek-V3', enabled: true },
  { id: 'arch', name: 'Architecture Agent', duty: 'Architecture / ADR / Design Review', skills: 'adr-draft, architecture-review', model: 'Claude Opus', enabled: true },
  { id: 'dev', name: 'Developer Agent', duty: '実装、Test、PR', skills: 'coding, test-generation, github-pr', model: 'Claude Code', enabled: true },
  { id: 'review', name: 'Reviewer Agent', duty: '独立Review（実装モデルと分離）', skills: 'code-review, security-review, test-review', model: 'DeepSeek-V3', enabled: true },
  { id: 'ops', name: 'Operations Agent', duty: 'Deploy、Runbook、Incident', skills: 'deploy, rollback, diagnostics', model: 'Claude Sonnet', enabled: false },
  { id: 'curator', name: 'Knowledge Curator', duty: 'Knowledge抽出・品質評価・昇格', skills: 'knowledge-discovery, quality-review, lifecycle', model: 'Claude Sonnet', enabled: true },
];

const SKILLS = [
  ['coding', '1.4.0', 'Developer', 'R2', 'approved'], ['github-pr', '1.2.1', 'Developer', 'R2', 'approved'],
  ['code-review', '1.1.0', 'Reviewer', 'R1', 'approved'], ['deploy', '0.9.0', 'Operations', 'R4', 'draft'],
  ['knowledge-discovery', '1.0.2', 'Knowledge Curator', 'R1', 'approved'], ['web-research', '2.0.0', 'Research', 'R0', 'approved'],
  ['adr-draft', '1.0.0', 'Architecture', 'R1', 'approved'], ['legacy-export', '0.3.0', 'Developer', 'R2', 'deprecated'],
];

const ROUTER = [
  { category: 'Research / Classification', model: 'DeepSeek-V3' }, { category: 'Architecture / Docs', model: 'Claude Opus' },
  { category: 'Repository Development', model: 'Claude Code' }, { category: 'Independent Review', model: 'DeepSeek-V3' },
  { category: 'High-volume Agent Loops', model: 'DeepSeek Harness' },
];

async function main() {
  const pool = getPool();
  const existing = await pool.query(`SELECT 1 FROM projects WHERE project_code = 'DX-2026-0042'`);
  if (existing.rows.length > 0) {
    console.log('既に投入済みのためスキップします（DX-2026-0042 が存在）。');
    await closePool();
    return;
  }

  await withTransaction(async (client) => {
    const userIds = {};
    for (const u of USERS) {
      const hash = await hashPassword(`demo-${u.key}-${Math.random().toString(36).slice(2)}`);
      const { rows } = await client.query(
        `INSERT INTO users (email, name, dept, role, password_hash) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [u.email, u.name, u.dept, u.role, hash],
      );
      userIds[u.key] = rows[0].id;
    }
    console.log(`users: ${Object.keys(userIds).length} 件`);

    const projectIds = {};
    for (const p of PROJECTS) {
      const ownerId = userIds[p.owner];
      const { rows: reqRows } = await client.query(
        `INSERT INTO requests (request_code, title, description, requester_id, status)
         VALUES ($1,$2,$3,$4,'promoted') RETURNING id`,
        [`REQ-SEED-${p.key}`, p.title, p.summary, ownerId],
      );
      const { rows: projRows } = await client.query(
        `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id, status, risk, repo)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8) RETURNING id`,
        [p.key, p.title, p.summary, reqRows[0].id, ownerId, p.status, p.risk, p.repo],
      );
      projectIds[p.key] = projRows[0].id;
      for (const [i, kpi] of p.kpis.entries()) {
        await client.query(
          `INSERT INTO project_kpis (project_id, name, target, current, unit, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
          [projRows[0].id, kpi.name, kpi.target, kpi.current, kpi.unit, i],
        );
      }
      await recordAudit(client, {
        actorId: ownerId, actorType: 'user', actorName: USERS.find((u) => u.key === p.owner).name,
        action: 'project.seed', resourceType: 'project', resourceId: projRows[0].id, detail: { code: p.key },
      });
    }
    console.log(`projects: ${Object.keys(projectIds).length} 件`);

    for (const t of TASKS) {
      const { rows } = await client.query(
        `INSERT INTO tasks (task_code, project_id, title, agent_name, provider, model, status,
                             tokens_in, tokens_out, cost, latency_ms, error_message, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [t.code, projectIds[t.pk], t.title, t.agent, t.provider, t.model, t.status,
         t.tin, t.tout, t.cost, t.lat, t.err || null, userIds.u2],
      );
      for (const [i, [name, risk, decision]] of t.tools.entries()) {
        await client.query(
          `INSERT INTO task_tool_calls (task_id, name, risk, decision, sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [rows[0].id, name, risk, decision, i],
        );
      }
    }
    console.log(`tasks: ${TASKS.length} 件`);

    for (const a of APPROVALS) {
      const { rows } = await client.query(
        `INSERT INTO approval_requests (approval_code, project_id, requested_by, type, risk, target, status, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7 = 'pending' THEN NULL ELSE now() END)
         RETURNING id`,
        [a.code, projectIds[a.pk], userIds[PROJECTS.find((p) => p.key === a.pk).owner], a.type, a.risk, a.target, a.status,
         a.status === 'pending' ? null : userIds[a.steps[a.steps.length - 1].who]],
      );
      for (const [i, s] of a.steps.entries()) {
        await client.query(
          `INSERT INTO approval_steps (approval_id, role, assigned_user_id, status, decided_at, reason, sort_order)
           VALUES ($1,$2,$3,$4, CASE WHEN $4 = 'pending' THEN NULL ELSE now() END, $5, $6)`,
          [rows[0].id, s.role, userIds[s.who], s.status, s.reason || null, i],
        );
      }
    }
    console.log(`approvals: ${APPROVALS.length} 件`);

    for (const k of KNOWLEDGE) {
      await client.query(
        `INSERT INTO knowledge_candidates (kc_code, title, type, project_id, score, status, summary, source, notion_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [k.code, k.title, k.type, projectIds[k.pk] || null, k.score, k.status, k.summary, k.source, k.notionRef || null],
      );
    }
    console.log(`knowledge: ${KNOWLEDGE.length} 件`);

    for (const i of INTEGRATIONS) {
      await client.query(
        `INSERT INTO integrations (id, name, role, status, last_sync_at, detail, note) VALUES ($1,$2,$3,$4, now(), $5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [i.id, i.name, i.role, i.status, i.detail, i.note],
      );
    }
    console.log(`integrations: ${INTEGRATIONS.length} 件`);

    for (const a of AGENTS) {
      await client.query(
        `INSERT INTO agents_config (id, name, duty, skills, model, enabled) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [a.id, a.name, a.duty, a.skills, a.model, a.enabled],
      );
    }
    console.log(`agents: ${AGENTS.length} 件`);

    for (const [name, version, ownerRole, risk, status] of SKILLS) {
      await client.query(
        `INSERT INTO skills_registry (name, version, owner_role, risk, status) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (name) DO NOTHING`,
        [name, version, ownerRole, risk, status],
      );
    }
    console.log(`skills: ${SKILLS.length} 件`);

    for (const [i, r] of ROUTER.entries()) {
      await client.query(
        `INSERT INTO model_router (category, model, sort_order) VALUES ($1,$2,$3) ON CONFLICT (category) DO NOTHING`,
        [r.category, r.model, i],
      );
    }
    console.log(`router: ${ROUTER.length} 件`);
  });

  console.log('デモデータ投入完了。');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
