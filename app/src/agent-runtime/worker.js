/**
 * Agent Runtime Worker（別プロセス）。
 * キューをポーリングしてRunを1件排他取得（Lease）し、Stepを1つずつ実行する。
 * LLM／外部応答待ちの間、DBトランザクションを保持しない（Step単位の短いトランザクションのみ）。
 *
 * 起動方法: node src/agent-runtime/worker.js
 * 停止方法: SIGTERM/SIGINT でグレースフルシャットダウン（実行中のStepの完了を待つ）。
 */
import { randomUUID } from 'node:crypto';
import { getPool, withTransaction } from '../lib/db.js';
import * as jobStore from './job-store.js';
import { executeNextStep } from './workflow-engine.js';
import { advanceAllOrchestrations } from './orchestrator.js';
import { expirePendingApprovals } from './run-approvals.js';

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = Number(process.env.AGENT_WORKER_POLL_MS || 2000);
const LEASE_SECONDS = Number(process.env.AGENT_WORKER_LEASE_SECONDS || 60);

let shuttingDown = false;

import { hostname } from 'node:os';

/** アイドル時も含め、ポーリングごとに生存を記録する（/api/health・watchdog が参照）。 */
async function beat(claimed = 0) {
  await withTransaction((client) => client.query(
    `INSERT INTO worker_heartbeats (worker_id, hostname, pid, runs_claimed)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), runs_claimed = worker_heartbeats.runs_claimed + EXCLUDED.runs_claimed`,
    [WORKER_ID, hostname(), process.pid, claimed],
  ));
}

async function tick() {
  // 承認期限（J-007）: 期限切れの申請を expired にし、待機中の Run を理由付きで中断する
  await withTransaction((client) => expirePendingApprovals(client)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[${WORKER_ID}] 承認期限の処理でエラー:`, err.message);
  });
  // 司令塔: 依存が満たされた Step の Run を作り、終わった Run を統合する（Run の実行自体は下の claim で行う）
  await withTransaction((client) => advanceAllOrchestrations(client)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[${WORKER_ID}] 司令塔の進行でエラー:`, err.message);
  });
  const run = await withTransaction((client) => jobStore.claimNextRun(client, { workerId: WORKER_ID, leaseSeconds: LEASE_SECONDS }));
  await beat(run ? 1 : 0);
  if (!run) return false;

  // eslint-disable-next-line no-console
  console.log(`[${WORKER_ID}] claimed ${run.run_code} (step ${run.current_step})`);
  try {
    let done = false;
    while (!done && !shuttingDown) {
      await withTransaction((client) => jobStore.heartbeat(client, run.id, WORKER_ID, LEASE_SECONDS));
      const result = await executeNextStep(run.id, { workerId: WORKER_ID });
      done = result.done;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${WORKER_ID}] Run ${run.run_code} で予期しないエラー:`, err.message);
    await withTransaction((client) => jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: `Worker内部エラー: ${err.message}` }));
  }
  return true;
}

async function loop() {
  while (!shuttingDown) {
    const worked = await tick();
    if (!worked) await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT', () => { shuttingDown = true; });

// eslint-disable-next-line no-console
console.log(`[${WORKER_ID}] Agent Runtime Worker 起動`);
loop().then(async () => {
  // 停止時はハートビート行を消し、監視側が「停止中」を即時に判定できるようにする
  await withTransaction((client) => client.query(`DELETE FROM worker_heartbeats WHERE worker_id = $1`, [WORKER_ID])).catch(() => {});
  await getPool().end();
  // eslint-disable-next-line no-console
  console.log(`[${WORKER_ID}] 停止しました`);
});
