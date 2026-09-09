/**
 * 永続Run（agent_runs）のDBアクセス層。Lease/Heartbeat/Checkpoint/予算予約をここに集約する。
 * Workerプロセスと、API（agent-runs.js）の両方から使われる。
 */
import { getPool } from '../lib/db.js';
import { nextRunCode } from '../lib/codes.js';

export async function createRun(client, { agentId, agentVersionId, projectId, requestedBy, inputJson, maxSteps }) {
  const runCode = await nextRunCode(client);
  const { rows } = await client.query(
    `INSERT INTO agent_runs (run_code, agent_id, agent_version_id, project_id, requested_by, input_json, max_steps)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [runCode, agentId, agentVersionId, projectId || null, requestedBy, JSON.stringify(inputJson || {}), maxSteps || 8],
  );
  return rows[0];
}

/** 利用者ごと・全体の「実行中または待機中」の Run 数（並行実行の上限判定に使う）。 */
export async function countActiveRuns(client, { userId }) {
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE requested_by = $1)::int AS for_user, count(*)::int AS total
     FROM agent_runs WHERE status IN ('queued', 'running')`,
    [userId],
  );
  return { forUser: rows[0].for_user, total: rows[0].total };
}

/** キュー内の実行可能なRunを1件、排他的に取得する（Postgresの定番パターン: FOR UPDATE SKIP LOCKED）。 */
export async function claimNextRun(client, { workerId, leaseSeconds = 60 }) {
  const { rows } = await client.query(
    `SELECT id, status, lease_owner, lease_expires_at FROM agent_runs
     WHERE (status = 'queued') OR (status = 'running' AND lease_expires_at < now())
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
  );
  if (rows.length === 0) return null;
  if (rows[0].status === 'running') {
    // 期限切れ Lease の引き継ぎは監査可能にする（前の Worker が停止・遅延した証跡）
    await appendEvent(client, rows[0].id, {
      type: 'lease_reclaimed', status: 'ok',
      detail: { previous_owner: rows[0].lease_owner, expired_at: rows[0].lease_expires_at, new_owner: workerId },
    });
  }
  const { rows: updated } = await client.query(
    `UPDATE agent_runs
     SET status = 'running', lease_owner = $1, lease_expires_at = now() + ($2 || ' seconds')::interval, updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [workerId, leaseSeconds, rows[0].id],
  );
  return updated[0];
}

export async function heartbeat(client, runId, workerId, leaseSeconds = 60) {
  await client.query(
    `UPDATE agent_runs SET lease_expires_at = now() + ($1 || ' seconds')::interval, updated_at = now()
     WHERE id = $2 AND lease_owner = $3`,
    [leaseSeconds, runId, workerId],
  );
}

/**
 * run_events へ追記する。seq は Run 全体で単調増加する連番を常にサーバ側で採番する
 * （呼び出し側の指定は受け付けない）。1 つの Run は Lease を持つ 1 Worker だけが書くため
 * MAX+1 で衝突しない。
 */
export async function appendEvent(client, runId, event) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id = $1`, [runId]);
  const seq = rows[0].seq;
  await client.query(
    `INSERT INTO run_events (run_id, seq, type, skill_id, skill_version, tool_name, status, detail, tokens_in, tokens_out, cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      runId, seq, event.type, event.skillId || null, event.skillVersion || null, event.toolName || null,
      event.status || null, JSON.stringify(event.detail || {}), event.tokensIn ?? null, event.tokensOut ?? null,
      event.cost ?? null,
    ],
  );
}

export async function advanceStep(client, runId, currentStep) {
  await client.query(`UPDATE agent_runs SET current_step = $1, updated_at = now() WHERE id = $2`, [currentStep, runId]);
}

export async function incrementAttempt(client, runId) {
  const { rows } = await client.query(
    `UPDATE agent_runs SET attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1 RETURNING attempt_count`,
    [runId],
  );
  return rows[0].attempt_count;
}

export async function markNoProgress(client, runId) {
  const { rows } = await client.query(
    `UPDATE agent_runs SET no_progress_count = no_progress_count + 1, updated_at = now() WHERE id = $1 RETURNING no_progress_count`,
    [runId],
  );
  return rows[0].no_progress_count;
}

export async function finishRun(client, runId, { status, errorMessage }) {
  await client.query(
    `UPDATE agent_runs SET status = $1, error_message = $2, finished_at = now(), updated_at = now(),
                            lease_owner = NULL, lease_expires_at = NULL
     WHERE id = $3`,
    [status, errorMessage || null, runId],
  );
}

export async function requestCancel(client, runId) {
  await client.query(`UPDATE agent_runs SET cancel_requested = true, updated_at = now() WHERE id = $1`, [runId]);
}

export async function isCancelRequested(client, runId) {
  const { rows } = await client.query(`SELECT cancel_requested FROM agent_runs WHERE id = $1`, [runId]);
  return rows[0]?.cancel_requested === true;
}

export async function resumeRun(client, runId) {
  await client.query(
    `UPDATE agent_runs SET status = 'queued', cancel_requested = false, pause_requested = false, waiting_reason = NULL,
                            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = $1`,
    [runId],
  );
}

/** 承認待ちへ遷移する。Lease を手放し（Worker を占有しない）、承認申請と理由を Run に残す。 */
export async function waitForApproval(client, runId, { reason, approvalRequestId }) {
  await client.query(
    `UPDATE agent_runs SET status = 'waiting_approval', waiting_reason = $1, approval_request_id = $2,
                            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = $3`,
    [reason, approvalRequestId, runId],
  );
}

export async function requestPause(client, runId) {
  await client.query(`UPDATE agent_runs SET pause_requested = true, updated_at = now() WHERE id = $1`, [runId]);
}

export async function isPauseRequested(client, runId) {
  const { rows } = await client.query(`SELECT pause_requested FROM agent_runs WHERE id = $1`, [runId]);
  return rows[0]?.pause_requested === true;
}

/** 一時停止（Step 境界でのみ遷移する。実行中の Step は完了させてから止まる）。 */
export async function pauseRun(client, runId, reason) {
  await client.query(
    `UPDATE agent_runs SET status = 'paused', pause_requested = false, waiting_reason = $1,
                            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = $2`,
    [reason || '利用者の一時停止要求', runId],
  );
}

/** 実行前に Lease の所有を確認する。期限切れで他 Worker に引き継がれていれば false。 */
export async function holdsLease(client, runId, workerId) {
  const { rows } = await client.query(
    `SELECT 1 FROM agent_runs WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND lease_expires_at >= now()`,
    [runId, workerId],
  );
  return rows.length > 0;
}

export async function getRun(client, runId) {
  const { rows } = await client.query(`SELECT * FROM agent_runs WHERE id = $1`, [runId]);
  return rows[0] || null;
}

export async function reserveBudget(client, runId, reservedUsd) {
  const { rows } = await client.query(
    `INSERT INTO budget_reservations (run_id, reserved_usd) VALUES ($1,$2) RETURNING *`,
    [runId, reservedUsd],
  );
  return rows[0];
}

export async function getActiveReservation(client, runId) {
  const { rows } = await client.query(
    `SELECT * FROM budget_reservations WHERE run_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [runId],
  );
  return rows[0] || null;
}

export async function spendBudget(client, reservationId, additionalCost) {
  const { rows } = await client.query(
    `UPDATE budget_reservations SET spent_usd = spent_usd + $1 WHERE id = $2 RETURNING *`,
    [additionalCost, reservationId],
  );
  return rows[0];
}

export async function releaseBudget(client, reservationId) {
  await client.query(`UPDATE budget_reservations SET status = 'released', released_at = now() WHERE id = $1`, [reservationId]);
}

export { getPool };
