/**
 * Run 作成の共通処理（API と運用 CLI が同じ検証・同じ監査を通る）。
 * - 入力キーの許可リスト（Agent ごとに固定）
 * - ロール（authorizeRunStart）
 * - 並行実行の上限（利用者ごと / 環境全体、C-14）。利用者単位の advisory lock で同時要求の競合を直列化する
 * - 承認済み Agent 版の存在
 * - 予算予約と監査記録
 */
import * as registry from './registry.js';
import * as jobStore from './job-store.js';
import { authorizeRunStart, authorizeRunConcurrency, PolicyDeniedError } from './policy-engine.js';
import { recordAudit } from '../lib/audit.js';
import { loadAgentDefinition, loadSkillDefinition, SkillLoaderError } from './skill-loader.js';

// 既存 P1 Agent の入力キー（Agent 契約に input_contract が無い場合の後方互換）。
export const AGENT_INPUT_ALLOWLIST = {
  'technology-selection': ['query'],
  'project-case-research': ['query'],
  'knowledge-quality': ['knowledge_candidate_id', 'title', 'summary', 'source'],
};

/**
 * Agent が受け付ける input_json のキー（Agent 契約 → 後方互換の固定表 → 最初の Skill の input schema の順）。
 * 利用者が任意のキーを混入できないようにする。契約に無い Agent は null（作成拒否）。
 */
export function inputKeysFor(agentId, packId = 'mirai-construction') {
  try {
    const def = loadAgentDefinition(packId, agentId).definition;
    if (def.input_contract && def.input_contract.properties) return [...Object.keys(def.input_contract.properties), 'prior_context'];
    if (AGENT_INPUT_ALLOWLIST[agentId]) return AGENT_INPUT_ALLOWLIST[agentId];
    const first = def.skills?.[0];
    if (first) {
      const sd = loadSkillDefinition(packId, first.skill_id, first.version);
      const keys = Object.keys(sd.inputSchema?.properties || {});
      if (keys.length) return [...keys, 'prior_context'];
    }
  } catch (err) {
    if (!(err instanceof SkillLoaderError)) throw err;
  }
  return AGENT_INPUT_ALLOWLIST[agentId] || null;
}

export function runBudgetUsd() {
  return Number(process.env.AGENT_RUN_BUDGET_USD || '0.50');
}

export function pickAllowed(input, keys) {
  const out = {};
  for (const k of keys) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

/**
 * 同一トランザクション内で呼ぶ。失敗は status 付きの Error（400 / 403 / 409）。
 * user: { id, name, role }、via: 'api' | 'cli'
 */
export async function createRunForUser(client, { user, agentId, projectId, input, via = 'api', maxSteps = 8, orchestration = null }) {
  const keys = agentId ? inputKeysFor(agentId) : null;
  if (!keys) throw Object.assign(new Error('不正な agentId'), { status: 400 });
  authorizeRunStart({ user }); // PolicyDeniedError（呼び出し側で 403 に変換）

  // 利用者ごとの作成を直列化し、上限チェックと INSERT の間で別要求が割り込めないようにする
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`agent_run_create:${user.id}`]);
  const active = await jobStore.countActiveRuns(client, { userId: user.id });
  authorizeRunConcurrency({ activeForUser: active.forUser, activeTotal: active.total });
  // F-32: 利用者あたりの日次作成上限（LLM 費用の暴走防止）
  const dailyLimit = Number(process.env.AGENT_RUN_MAX_PER_USER_PER_DAY || '50');
  const { rows: today } = await client.query(`SELECT count(*)::int AS n FROM agent_runs WHERE requested_by = $1 AND created_at >= date_trunc('day', now())`, [user.id]);
  if (today[0].n >= dailyLimit) {
    throw Object.assign(new PolicyDeniedError(`本日の Run 作成上限（利用者あたり ${dailyLimit} 件）に達しました。明日以降に再度開始してください`), { code: 'concurrency' });
  }

  const agentVersionInfo = await registry.getApprovedAgentVersion(client, agentId);
  if (!agentVersionInfo) throw Object.assign(new Error(`Agent「${agentId}」の承認済み版がありません`), { status: 409 });

  const run = await jobStore.createRun(client, {
    agentId, agentVersionId: agentVersionInfo.agentVersion.id, projectId: projectId || null, requestedBy: user.id,
    inputJson: pickAllowed(input || {}, keys), maxSteps,
  });
  if (orchestration) {
    await client.query(`UPDATE agent_runs SET orchestration_id = $1, orchestration_step_id = $2 WHERE id = $3`, [orchestration.id, orchestration.stepId, run.id]);
  }
  await jobStore.reserveBudget(client, run.id, runBudgetUsd());
  await recordAudit(client, {
    actorId: user.id, actorType: 'user', actorName: user.name,
    action: 'agent_run.create', resourceType: 'agent_run', resourceId: run.id,
    detail: { agentId, runCode: run.run_code, via, activeForUser: active.forUser + 1, orchestrationId: orchestration ? Number(orchestration.id) : null },
  });
  return run;
}
