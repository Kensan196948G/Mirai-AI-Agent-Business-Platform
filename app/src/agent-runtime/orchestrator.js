/**
 * CTO Orchestrator（司令塔）。
 *   利用者要求 → 意図分類・リスク推定 → 組織 Agent / 土木専門 Agent の選択（理由付き）→ 実行順序（依存関係）→
 *   複数 Agent Run の作成・進行管理 → 結果の統合（不足は「不足」と明示）→ 人間レビュー必須。
 *
 * 統制:
 *   - 選べるのは Registry で承認済み・実行可能な Agent だけ。候補（P2/P3）や未承認は「利用不可」として理由を残し、勝手に別経路へ迂回しない
 *   - Policy DENY / 承認待ち（approval_gate）は各 Run の仕組みがそのまま効く（司令塔は上書きできない）
 *   - 予算: 司令塔全体の上限（ORCHESTRATION_BUDGET_USD、既定 2.0）と Run ごとの予算（AGENT_RUN_BUDGET_USD）の二重
 *   - Step 数上限（ORCHESTRATION_MAX_STEPS、既定 4）、Agent 間の再帰呼び出しは持たない（司令塔だけが Run を作る）
 *   - 部分失敗は partial として表現し、失敗した Agent の結果を成功扱いしない
 */
import { structuredComplete, isConfigured } from './provider-adapter.js';
import { catalogForPrompt, catalogWithRuntime, matchByKeywords, findAgent } from './catalog.js';
import { technicalRiskPolicy } from './skill-loader.js';
import { createRunForUser, inputKeysFor } from './run-create.js';
import * as llm from '../lib/llm.js';
import { recordAudit } from '../lib/audit.js';
import { enforceOutputPolicy } from './prompt-guard.js';
import { nextArtifactCode } from '../lib/codes.js';
import { contentHash } from '../lib/artifact-lineage.js';

export const ORCHESTRATION_MAX_STEPS = () => Number(process.env.ORCHESTRATION_MAX_STEPS || '6');
export const ORCHESTRATION_BUDGET_USD = () => Number(process.env.ORCHESTRATION_BUDGET_USD || '2.0');

const PLAN_SCHEMA = {
  type: 'object', required: ['intent', 'risk', 'steps', 'rejected', 'summary'], additionalProperties: false,
  properties: {
    intent: { type: 'string', maxLength: 80 },
    risk: { type: 'string', enum: ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] },
    summary: { type: 'string', maxLength: 300 },
    steps: {
      type: 'array', maxItems: 8,
      items: { type: 'object', required: ['agent_id', 'reason', 'query', 'depends_on'], additionalProperties: false, properties: {
        agent_id: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: 200 }, query: { type: 'string', maxLength: 600 },
        depends_on: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 5 },
      } },
    },
    rejected: { type: 'array', maxItems: 6, items: { type: 'object', required: ['agent_id', 'reason'], additionalProperties: false, properties: { agent_id: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: 200 } } } },
  },
};

const PLAN_INSTRUCTIONS =
  'あなたは建設会社の AI 基盤の司令塔（CTO Orchestrator）です。利用者要求を読み、catalog.agents の中から要求に必要な Agent を選び、' +
  '実行順序（depends_on は先行 step の番号、独立なら空）と、各 Agent へ渡す具体的な相談文（query）を決めてください。' +
  '選ぶのは executable=true の Agent だけです。候補（executable=false）は steps に入れず rejected に理由付きで挙げます。' +
  '要求に関係しない Agent は選びません。技術判断・施工可否・最終決定は Agent ではなく人間が行うため、summary にその旨を含めます。' +
  'risk は外部影響の大きさで R0〜R5。書かれていないことは推測せず、不足は summary に明記します。' +
  'layer=civil_expert の Agent（土木専門）は、組織責務 Agent（layer=organization）の delegates_to に含まれ、かつ要求が専門的な技術条件（地盤・港湾・構造・施工・環境・維持管理・数量・データ）に触れる場合だけ、' +
  'その組織責務 Agent の後段（depends_on に組織 Agent の番号）として選びます。専門 Agent を単独で先頭に置きません。technical_risk_class が T5/T6 の Agent の結果は AI 単独では完了できず専門技術者の確認が必須です。';

async function nextOrchestrationCode(client) {
  const { rows } = await client.query(`SELECT MAX(substring(orchestration_code FROM '^ORC-(\\d+)$')::int) AS n FROM orchestrations`);
  return `ORC-${Math.max(Number(rows[0].n) || 0, 1000) + 1}`;
}

/** ルールベースの計画（LLM 未設定時、または LLM 計画の検証失敗時）。 */
export function scriptedPlan(requestText, runtimeCatalog) {
  const kw = matchByKeywords(requestText);
  const executable = new Map(runtimeCatalog.agents.filter((a) => a.runnable).map((a) => [a.agent_id, a]));
  const steps = []; const rejected = [];
  for (const { agent_id } of kw.agents) {
    const a = runtimeCatalog.agents.find((x) => x.agent_id === agent_id);
    if (!a) continue;
    if (!executable.has(agent_id)) { rejected.push({ agent_id, reason: a.executable ? 'Registry で未承認のため利用不可' : `${a.stage} の候補（未実装）のため利用不可` }); continue; }
    if (agent_id === 'knowledge-quality') { rejected.push({ agent_id, reason: 'Knowledge 候補の指定が必要なため司令塔からは起動しない' }); continue; }
    steps.push({ agent_id, reason: '要求文の語が Agent の用途と一致', query: requestText, depends_on: [] });
  }
  // B-005: 組織責務 Agent の delegates_to にある土木専門 Agent のうち、要求文が専門用語（Agent の keywords）に一致するものを後段に委譲する
  const orgSteps = steps.slice(0, ORCHESTRATION_MAX_STEPS());
  const expertSteps = [];
  for (const { agent_id } of kw.experts || []) {
    const delegator = orgSteps.find((s) => (findAgent(s.agent_id)?.delegates_to || []).includes(agent_id));
    if (!delegator) { rejected.push({ agent_id, reason: '専門用語は一致したが、選ばれた組織責務 Agent の委譲先に無いため起動しない' }); continue; }
    const a = runtimeCatalog.agents.find((x) => x.agent_id === agent_id);
    if (!a || !executable.has(agent_id)) { rejected.push({ agent_id, reason: 'Registry で未承認のため利用不可' }); continue; }
    if (orgSteps.length + expertSteps.length >= ORCHESTRATION_MAX_STEPS()) { rejected.push({ agent_id, reason: '司令塔の Step 上限に達したため起動しない' }); continue; }
    expertSteps.push({ agent_id, reason: `${delegator.agent_id} からの委譲（専門用語が一致、${a.technical_risk_class || 'T?'}）`, query: requestText, depends_on: [orgSteps.indexOf(delegator) + 1] });
  }
  const all = [...orgSteps, ...expertSteps];
  const maxRisk = maxTechnicalRisk(all.map((s) => findAgent(s.agent_id)?.technical_risk_class));
  return { source: 'scripted', intent: '相談 / 未分類', risk: 'R1', summary: all.length ? `語の一致で Agent を選択${expertSteps.length ? `（土木専門 ${expertSteps.length} 件へ委譲、最大技術リスク ${maxRisk}）` : ''}。最終判断は人間が行う` : '要求に合う実行可能な Agent が無い（候補は rejected を参照）', steps: all, rejected };
}

/** T1〜T6 の最大値（無ければ null）。 */
export function maxTechnicalRisk(classes) {
  const levels = classes.map((c) => technicalRiskPolicy(c).level).filter((n) => n !== null);
  return levels.length ? `T${Math.max(...levels)}` : null;
}

/** LLM で計画し、カタログ・承認状態で検証する。 */
export async function planOrchestration(client, { requestText, llmAllowed = true }) {
  const runtimeCatalog = await catalogWithRuntime(client);
  const fallback = scriptedPlan(requestText, runtimeCatalog);
  if (!llmAllowed || !isConfigured()) return { ...fallback, cost: 0, tokensIn: 0, tokensOut: 0 };
  let result;
  try {
    const promptCatalog = catalogForPrompt();
    result = await structuredComplete({
      instructions: PLAN_INSTRUCTIONS,
      input: { request: requestText, catalog: { ...promptCatalog, agents: promptCatalog.agents.map((a) => ({ ...a, executable: !!runtimeCatalog.agents.find((r) => r.agent_id === a.agent_id)?.runnable })) } },
      schema: PLAN_SCHEMA, fallbackData: { intent: fallback.intent, risk: fallback.risk, summary: fallback.summary, steps: fallback.steps.map((s) => ({ agent_id: s.agent_id, reason: s.reason, query: s.query, depends_on: [] })), rejected: fallback.rejected },
    });
  } catch (err) {
    return { ...fallback, llm_error: err.message, cost: 0, tokensIn: 0, tokensOut: 0 };
  }
  if (result.degraded) return { ...fallback, llm_degraded: result.degradedReason || true, cost: result.cost || 0, tokensIn: result.tokensIn || 0, tokensOut: result.tokensOut || 0 };
  const d = result.data;
  const runnable = new Set(runtimeCatalog.agents.filter((a) => a.runnable).map((a) => a.agent_id));
  const steps = []; const rejected = [...d.rejected.filter((r) => findAgent(r.agent_id))];
  for (const s of d.steps.slice(0, ORCHESTRATION_MAX_STEPS())) {
    const a = findAgent(s.agent_id);
    if (!a) { rejected.push({ agent_id: s.agent_id, reason: 'カタログに存在しない Agent（LLM の提案を不採用）' }); continue; }
    if (!runnable.has(s.agent_id)) { rejected.push({ agent_id: s.agent_id, reason: a.executable ? 'Registry で未承認のため利用不可' : `${a.stage} の候補（未実装）のため利用不可` }); continue; }
    if (s.agent_id === 'knowledge-quality') { rejected.push({ agent_id: s.agent_id, reason: 'Knowledge 候補の指定が必要なため司令塔からは起動しない' }); continue; }
    if (steps.some((x) => x.agent_id === s.agent_id)) continue;
    const depends = s.depends_on.filter((n) => n >= 1 && n <= steps.length);
    if (a.layer === 'civil_expert') {
      // 専門 Agent は委譲元の組織責務 Agent の後段としてのみ採用する（先頭や無関係な組織 Agent からの起動は不採用）
      const delegatorSeq = depends.find((n) => (findAgent(steps[n - 1].agent_id)?.delegates_to || []).includes(s.agent_id));
      if (!delegatorSeq) { rejected.push({ agent_id: s.agent_id, reason: '土木専門 Agent は委譲元の組織責務 Agent の後段としてのみ起動できる（LLM の提案を不採用）' }); continue; }
    }
    steps.push({ agent_id: s.agent_id, reason: s.reason, query: s.query || requestText, depends_on: depends });
  }
  return { source: 'llm', intent: d.intent, risk: d.risk, summary: d.summary, steps, rejected, cost: result.cost || 0, tokensIn: result.tokensIn || 0, tokensOut: result.tokensOut || 0, provider: result.provider, model: result.model };
}

/** 計画を保存し、依存の無い Step の Run を作って開始する。戻り値: orchestration 行。 */
export async function createOrchestration(client, { user, requestText, projectId = null }) {
  const llmAllowed = llm.isConfigured() && (await llm.withinMonthlyBudget(client));
  const plan = await planOrchestration(client, { requestText, llmAllowed });
  const code = await nextOrchestrationCode(client);
  const status = plan.steps.length === 0 ? 'blocked' : 'planned';
  const { rows } = await client.query(
    `INSERT INTO orchestrations (orchestration_code, requested_by, project_id, request_text, intent, risk, plan_source, plan_json, status, budget_usd, cost_usd, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [code, user.id, projectId, requestText, plan.intent, plan.risk, plan.source, JSON.stringify({ summary: plan.summary, rejected: plan.rejected, llm_degraded: plan.llm_degraded || null, llm_error: plan.llm_error || null, provider: plan.provider || null, model: plan.model || null }),
      status, ORCHESTRATION_BUDGET_USD(), plan.cost || 0, status === 'blocked' ? '要求に合う実行可能な Agent がありません（候補は計画の rejected を参照）。人間の判断が必要です' : null],
  );
  const orch = rows[0];
  for (const [i, s] of plan.steps.entries()) {
    await client.query(
      `INSERT INTO orchestration_steps (orchestration_id, seq, agent_id, layer, depends_on, input_json, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orch.id, i + 1, s.agent_id, findAgent(s.agent_id)?.layer || 'organization', s.depends_on, JSON.stringify({ query: s.query }), s.reason],
    );
  }
  await recordAudit(client, {
    actorId: user.id, actorType: 'user', actorName: user.name, action: 'orchestration.create', resourceType: 'orchestration', resourceId: orch.id,
    detail: { code, plan_source: plan.source, intent: plan.intent, risk: plan.risk, steps: plan.steps.map((s) => ({ agent_id: s.agent_id, reason: s.reason, depends_on: s.depends_on })), rejected: plan.rejected },
  });
  if (status === 'planned') await advanceOrchestration(client, orch.id, { user });
  return (await client.query(`SELECT * FROM orchestrations WHERE id = $1`, [orch.id])).rows[0];
}

/**
 * 進行管理（Worker のポーリングと API から呼ぶ）。依存が完了した Step の Run を作り、Run の状態を Step へ反映し、
 * 全 Step が終われば統合する。Run の作成は通常の createRunForUser（ロール・上限・承認済み版・予算・監査）を通す。
 */
export async function advanceOrchestration(client, orchestrationId, { user = null } = {}) {
  const { rows: o } = await client.query(`SELECT * FROM orchestrations WHERE id = $1 FOR UPDATE`, [orchestrationId]);
  const orch = o[0];
  if (!orch || ['completed', 'partial', 'failed', 'cancelled', 'blocked'].includes(orch.status)) return orch;
  const { rows: steps } = await client.query(`SELECT * FROM orchestration_steps WHERE orchestration_id = $1 ORDER BY seq`, [orchestrationId]);
  const requester = user || (await client.query(`SELECT id, name, role FROM users WHERE id = $1`, [orch.requested_by])).rows[0];

  if (orch.cancel_requested) {
    for (const s of steps) {
      if (s.run_id && ['pending', 'running', 'waiting_approval'].includes(s.status)) await client.query(`UPDATE agent_runs SET cancel_requested = true WHERE id = $1 AND status IN ('queued','running','waiting_approval','paused')`, [s.run_id]);
      if (s.status === 'pending') await client.query(`UPDATE orchestration_steps SET status = 'cancelled', finished_at = now() WHERE id = $1`, [s.id]);
    }
  }

  // 1. Run の状態を Step に反映
  const bySeq = new Map(steps.map((s) => [s.seq, s]));
  for (const s of steps) {
    if (!s.run_id) continue;
    const { rows: r } = await client.query(`SELECT status, error_message FROM agent_runs WHERE id = $1`, [s.run_id]);
    const st = r[0]?.status;
    const map = { queued: 'running', running: 'running', waiting_approval: 'waiting_approval', paused: 'waiting_approval', completed: 'completed', failed: 'failed', cancelled: 'cancelled' };
    const next = map[st] || s.status;
    if (next !== s.status) {
      await client.query(`UPDATE orchestration_steps SET status = $1, error_message = $2, finished_at = CASE WHEN $1 IN ('completed','failed','cancelled') THEN now() ELSE finished_at END WHERE id = $3`, [next, r[0]?.error_message || null, s.id]);
      s.status = next;
    }
  }
  // 2. 依存が満たされた pending Step の Run を作る（先行が失敗・中断なら skipped）
  let cost = 0;
  for (const s of steps) {
    if (s.status !== 'pending' || orch.cancel_requested) continue;
    const deps = (s.depends_on || []).map((n) => bySeq.get(n)).filter(Boolean);
    if (deps.some((d) => ['failed', 'cancelled', 'skipped', 'blocked'].includes(d.status))) {
      await client.query(`UPDATE orchestration_steps SET status = 'skipped', error_message = '先行 Step が失敗・中断したため実行しない', finished_at = now() WHERE id = $1`, [s.id]);
      s.status = 'skipped'; continue;
    }
    if (!deps.every((d) => d.status === 'completed')) continue;
    // 先行 Step の成果（findings / unknowns）を context として渡す（入力契約に無いキーは createRunForUser が落とす）
    const priorContext = [];
    for (const d of deps) {
      const { rows: arts } = await client.query(`SELECT artifact_code, content FROM artifacts WHERE run_id = $1 ORDER BY id`, [d.run_id]);
      for (const a of arts) priorContext.push({ agent_id: d.agent_id, artifact_code: a.artifact_code, findings: (a.content?.findings || []).slice(0, 10), unknowns: (a.content?.unknowns || []).slice(0, 10) });
    }
    try {
      const run = await createRunForUser(client, { user: requester, agentId: s.agent_id, projectId: orch.project_id, input: { ...s.input_json, prior_context: priorContext }, via: 'orchestrator', orchestration: { id: orch.id, stepId: s.id } });
      await client.query(`UPDATE orchestration_steps SET status = 'running', run_id = $1, started_at = now() WHERE id = $2`, [run.id, s.id]);
      s.status = 'running'; s.run_id = run.id;
    } catch (err) {
      const blocked = /上限|未承認|権限|承認済み版/.test(err.message);
      await client.query(`UPDATE orchestration_steps SET status = $1, error_message = $2, finished_at = now() WHERE id = $3`, [blocked ? 'blocked' : 'failed', err.message, s.id]);
      s.status = blocked ? 'blocked' : 'failed';
    }
  }
  // 3. 費用の集計と全体状態
  const runIds = steps.map((s) => s.run_id).filter(Boolean);
  if (runIds.length) {
    const { rows: c } = await client.query(`SELECT COALESCE(SUM(spent_usd),0)::float AS cost FROM budget_reservations WHERE run_id = ANY($1::bigint[])`, [runIds]);
    cost = c[0].cost;
  }
  const total = Number(orch.cost_usd) + 0; // 計画時の LLM 費用
  const allDone = steps.every((s) => ['completed', 'failed', 'cancelled', 'skipped', 'blocked'].includes(s.status));
  let status = 'running';
  if (steps.some((s) => s.status === 'waiting_approval')) status = 'waiting_approval';
  if (allDone) {
    const completed = steps.filter((s) => s.status === 'completed').length;
    const allBlocked = steps.every((s) => s.status === 'blocked');
    status = orch.cancel_requested ? 'cancelled' : completed === steps.length ? 'completed' : completed > 0 ? 'partial' : allBlocked ? 'blocked' : 'failed';
  }
  if (cost + total > Number(orch.budget_usd) && status === 'running') {
    // 予算超過: 未着手の Step は blocked にし、全体を partial で止める（隠さない）
    for (const s of steps) if (s.status === 'pending') await client.query(`UPDATE orchestration_steps SET status = 'blocked', error_message = '司令塔の予算上限に達したため実行しない', finished_at = now() WHERE id = $1`, [s.id]);
    status = steps.some((s) => s.status === 'running' || s.status === 'waiting_approval') ? 'running' : 'partial';
  }
  await client.query(`UPDATE orchestrations SET status = $1, cost_usd = $2, updated_at = now() WHERE id = $3`, [status, (cost + total).toFixed(4), orch.id]);
  if (['completed', 'partial', 'failed', 'cancelled'].includes(status)) await finalizeOrchestration(client, orch, steps, status);
  return (await client.query(`SELECT * FROM orchestrations WHERE id = $1`, [orch.id])).rows[0];
}

/** 全 Step の成果物を 1 つの統合草案にまとめる（Agent ごとに帰属を残し、失敗した Agent は「不足」として明記）。 */
async function finalizeOrchestration(client, orch, steps, status) {
  const sections = []; const unknowns = []; const sources = new Map(); let findingsCount = 0;
  for (const s of steps) {
    if (s.status === 'completed' && s.run_id) {
      const { rows: arts } = await client.query(`SELECT artifact_code, content FROM artifacts WHERE run_id = $1 ORDER BY id`, [s.run_id]);
      for (const a of arts) {
        sections.push({ agent_id: s.agent_id, artifact_code: a.artifact_code, findings: a.content?.findings || [], unknowns: a.content?.unknowns || [], assumptions: a.content?.assumptions || [] });
        findingsCount += (a.content?.findings || []).length;
        for (const src of a.content?.sources || []) if (src?.source_record_id) sources.set(Number(src.source_record_id), src);
        for (const u of a.content?.unknowns || []) unknowns.push(`[${s.agent_id}] ${u}`);
      }
    } else {
      unknowns.push(`[${s.agent_id}] 結果なし（${s.status}${s.error_message ? ': ' + s.error_message : ''}）`);
    }
  }
  const maxRisk = maxTechnicalRisk(steps.map((s) => findAgent(s.agent_id)?.technical_risk_class));
  const riskPolicy = technicalRiskPolicy(maxRisk);
  const content = enforceOutputPolicy({
    findings: sections.flatMap((x) => x.findings.map((f) => `[${x.agent_id}] ${f}`)), unknowns, assumptions: sections.flatMap((x) => x.assumptions),
    sources: [...sources.values()], sections, orchestration_status: status, requires_human_review: true,
    technical_risk_class: maxRisk, expert_review_required: riskPolicy.expert_review_required, ai_completion_prohibited: riskPolicy.ai_completion_prohibited,
    summary: `${steps.length} Agent 中 ${sections.length} 件の成果を統合。事実 ${findingsCount} 件、不明点 ${unknowns.length} 件。採用・施工可否・最終決定は人間が行う` +
      (riskPolicy.ai_completion_prohibited ? `。最大技術リスク ${maxRisk}: AI 単独では完了できず、専門技術者の確認記録が必須` : riskPolicy.expert_review_required ? `。最大技術リスク ${maxRisk}: 専門技術者レビュー必須` : ''),
  }, { requireHumanReview: true }).output;
  const code = await nextArtifactCode(client);
  const { rows } = await client.query(
    `INSERT INTO artifacts (artifact_code, run_id, kind, title, content, review_state, content_hash, orchestration_id, expert_review_required, ai_completion_prohibited)
     VALUES ($1, $2, 'orchestration_summary', $3, $4, 'draft', $5, $6, $7, $8) RETURNING id`,
    [code, steps.find((s) => s.run_id)?.run_id || null, `司令塔 ${orch.orchestration_code} 統合草案`, JSON.stringify(content), contentHash(content), orch.id, riskPolicy.expert_review_required, riskPolicy.ai_completion_prohibited],
  ).catch(async (err) => {
    // run_id が無い（全 Step が blocked 等）場合は統合草案を作らず、理由だけ残す
    await client.query(`UPDATE orchestrations SET error_message = COALESCE(error_message, $1) WHERE id = $2`, [`統合草案なし: ${err.message}`, orch.id]);
    return { rows: [] };
  });
  await client.query(`UPDATE orchestrations SET final_artifact_id = $1, finished_at = now(), updated_at = now() WHERE id = $2`, [rows[0]?.id || null, orch.id]);
  await recordAudit(client, {
    actorId: null, actorType: 'agent', actorName: 'cto-orchestrator', action: 'orchestration.finish', resourceType: 'orchestration', resourceId: orch.id,
    detail: { code: orch.orchestration_code, status, steps: steps.map((s) => ({ agent_id: s.agent_id, status: s.status })), final_artifact_id: rows[0]?.id || null },
  });
}

/** Worker のポーリングから呼ぶ: 進行中の司令塔を全て前へ進める。 */
export async function advanceAllOrchestrations(client) {
  const { rows } = await client.query(`SELECT id FROM orchestrations WHERE status IN ('planned','running','waiting_approval') ORDER BY id`);
  for (const r of rows) await advanceOrchestration(client, r.id);
  return rows.length;
}

export { inputKeysFor };
