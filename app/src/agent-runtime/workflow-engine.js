/**
 * Workflow Engine: 1つのRunのStepを1つずつ実行する。DBトランザクションを長時間保持したまま
 * LLM／外部API応答を待たない（Step単位で独立した短いトランザクションに分ける）。
 */
import Ajv from 'ajv';
import { getPool, withTransaction } from '../lib/db.js';
import * as jobStore from './job-store.js';
import * as registry from './registry.js';
import { loadSkillDefinition } from './skill-loader.js';
import { callTool } from './tool-gateway.js';
import { structuredComplete, ProviderNotConfiguredError } from './provider-adapter.js';
import { withinMonthlyBudget, monthlyCapUsd } from '../lib/llm.js';
import { validateCitations } from './evidence-validator.js';
import { authorizeBudget, PolicyDeniedError } from './policy-engine.js';
import { SKILL_HANDLERS } from './skills/index.js';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Runを1Stepだけ進める。呼び出し側（worker.js）がこの関数をループ呼び出しする。
 * 戻り値: { done: boolean, run } done=true ならRunは完了・失敗・キャンセル・承認待ちのいずれかに遷移済み。
 */
export async function executeNextStep(runId, { workerId }) {
  const runContext = await withTransaction(async (client) => {
    const run = await jobStore.getRun(client, runId);
    if (!run) throw new Error(`Run ${runId} が見つかりません`);
    const agentVersionInfo = await registry.getAgentVersionById(client, run.agent_version_id);
    return { run, agentVersionInfo };
  });

  const { run, agentVersionInfo } = runContext;
  const { agentVersion, skillVersions } = agentVersionInfo;

  if (await checkCancel(run.id)) return finishAs(run.id, 'cancelled', null);
  if (run.current_step >= skillVersions.length) return finishAs(run.id, 'completed', null);
  if (run.current_step >= run.max_steps) return finishAs(run.id, 'failed', `最大Step数（${run.max_steps}）に到達しました`);

  const stepIndex = run.current_step;
  const skillVersionRow = skillVersions[stepIndex];

  return withTransaction(async (client) => {
    // 実行直前に版の有効性を再検証する（承認取消・deprecated化を反映する）。
    const freshSkillVersion = await registry.getSkillVersionById(client, skillVersionRow.id);
    if (!freshSkillVersion || freshSkillVersion.status !== 'approved') {
      await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: `Skill版が無効化されています: ${skillVersionRow.skill_id}` });
      return { done: true, run: await jobStore.getRun(client, run.id) };
    }

    const skillDef = loadSkillDefinition(freshSkillVersion.domain_pack, freshSkillVersion.skill_id, freshSkillVersion.version);

    const priorOutputs = await collectPriorOutputs(client, run.id);
    const input = { ...run.input_json, ...priorOutputs };

    const validateInput = ajv.compile(skillDef.inputSchema);
    if (!validateInput(input)) {
      await jobStore.appendEvent(client, run.id, {
        type: 'step_started', skillId: skillDef.skillId, skillVersion: freshSkillVersion.version, status: 'error',
        detail: { error: `入力検証エラー: ${ajv.errorsText(validateInput.errors)}` },
      });
      return handleStepFailure(client, run, `入力検証エラー（${skillDef.skillId}）: ${ajv.errorsText(validateInput.errors)}`);
    }

    await jobStore.appendEvent(client, run.id, {
      type: 'step_started', skillId: skillDef.skillId, skillVersion: freshSkillVersion.version, status: 'ok', detail: {},
    });

    const stepUsage = { tokensIn: 0, tokensOut: 0, cost: 0 };
    const ctx = {
      client, run, agentVersion, skillDef, skillVersion: freshSkillVersion, input, allSkillVersions: skillVersions,
      callTool: async (toolName, args) => callTool(client, { run, skillVersion: freshSkillVersion, toolName, args }),
      validateCitations: (sources) => validateCitations(client, { run, sources }),
      structuredComplete: async (opts) => {
        // 月次ソフトキャップ（AI相談と共通）を超えている場合は LLM を呼ばず保留する（偽の成功にしない）。
        if (!(await withinMonthlyBudget(client))) {
          throw new PolicyDeniedError(`月次のLLM利用上限（$${monthlyCapUsd()}）に達しているため実行を保留します`);
        }
        const reservation = await jobStore.getActiveReservation(client, run.id);
        const result = await structuredComplete(opts);
        stepUsage.tokensIn += result.tokensIn || 0;
        stepUsage.tokensOut += result.tokensOut || 0;
        stepUsage.cost += result.cost || 0;
        if (reservation && result.cost > 0) {
          authorizeBudget({ reservation, additionalCost: result.cost });
          await jobStore.spendBudget(client, reservation.id, result.cost);
        }
        return result;
      },
    };

    let output;
    try {
      const handler = SKILL_HANDLERS[skillDef.skillId];
      if (!handler) throw new Error(`Skillの実装がありません: ${skillDef.skillId}`);
      output = await handler(ctx);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        await jobStore.appendEvent(client, run.id, {
          type: 'error', skillId: skillDef.skillId, skillVersion: freshSkillVersion.version, status: 'error',
          detail: { error: err.message },
        });
        await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: `LLM未設定のため実行できません（${skillDef.skillId}）` });
        return { done: true, run: await jobStore.getRun(client, run.id) };
      }
      if (err instanceof PolicyDeniedError) {
        await jobStore.appendEvent(client, run.id, {
          type: 'error', skillId: skillDef.skillId, skillVersion: freshSkillVersion.version, status: 'error',
          detail: { error: err.message },
        });
        await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: err.message });
        return { done: true, run: await jobStore.getRun(client, run.id) };
      }
      return handleStepFailure(client, run, `Step実行エラー（${skillDef.skillId}）: ${err.message}`);
    }

    const validateOutput = ajv.compile(skillDef.outputSchema);
    if (!validateOutput(output)) {
      return handleStepFailure(client, run, `出力検証エラー（${skillDef.skillId}）: ${ajv.errorsText(validateOutput.errors)}`);
    }

    await jobStore.appendEvent(client, run.id, {
      type: 'step_completed', skillId: skillDef.skillId, skillVersion: freshSkillVersion.version, status: 'ok', detail: output,
      tokensIn: stepUsage.tokensIn || null, tokensOut: stepUsage.tokensOut || null, cost: stepUsage.cost || null,
    });
    await client.query(
      `UPDATE agent_runs SET no_progress_count = 0 WHERE id = $1`,
      [run.id],
    );
    await jobStore.advanceStep(client, run.id, stepIndex + 1);

    const isLastStep = stepIndex + 1 >= skillVersions.length;
    if (isLastStep) {
      await jobStore.finishRun(client, run.id, { status: 'completed', errorMessage: null });
    }
    return { done: isLastStep, run: await jobStore.getRun(client, run.id) };
  });
}

// 複数Stepで共通して現れるフィールドは、単純上書きではなく蓄積する
// （「unknowns」を上書きすると、途中Stepで見つかった不明点が最終成果物から消えてしまうため）。
const ACCUMULATING_FIELDS = new Set(['unknowns', 'assumptions']);

async function collectPriorOutputs(client, runId) {
  const { rows } = await client.query(
    `SELECT detail FROM run_events WHERE run_id = $1 AND type = 'step_completed' ORDER BY seq`,
    [runId],
  );
  let merged = {};
  for (const r of rows) {
    for (const [key, value] of Object.entries(r.detail || {})) {
      if (ACCUMULATING_FIELDS.has(key) && Array.isArray(value)) {
        merged[key] = [...new Set([...(merged[key] || []), ...value])];
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

async function handleStepFailure(client, run, message) {
  const attempts = await jobStore.incrementAttempt(client, run.id);
  await jobStore.appendEvent(client, run.id, {
    type: 'error', status: 'error', detail: { error: message, attempt: attempts },
  });
  if (attempts >= run.max_attempts_per_step) {
    const noProgress = await jobStore.markNoProgress(client, run.id);
    if (noProgress >= 3) {
      await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: `進展なしが3回続いたため停止しました: ${message}` });
      return { done: true, run: await jobStore.getRun(client, run.id) };
    }
    await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: message });
    return { done: true, run: await jobStore.getRun(client, run.id) };
  }
  return { done: false, run: await jobStore.getRun(client, run.id) };
}

async function checkCancel(runId) {
  return withTransaction((client) => jobStore.isCancelRequested(client, runId));
}

async function finishAs(runId, status, errorMessage) {
  return withTransaction(async (client) => {
    await jobStore.finishRun(client, runId, { status, errorMessage });
    return { done: true, run: await jobStore.getRun(client, runId) };
  });
}

export { getPool };
