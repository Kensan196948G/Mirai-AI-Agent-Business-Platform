/**
 * 永続Run（agent_runs）のDBアクセス層。Lease/Heartbeat/Checkpoint/予算予約をここに集約する。
 * Workerプロセスと、API（agent-runs.js）の両方から使われる。
 */
import { getPool } from '../lib/db.js';

async function nextRunCode(client) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM agent_runs`);
  return `RUN-${1000 + rows[0].n + 1}`;
}

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

/** キュー内の実行可能なRunを1件、排他的に取得する（Postgresの定番パターン: FOR UPDATE SKIP LOCKED）。 */
export async function claimNextRun(client, { workerId, leaseSeconds = 60 }) {
  const { rows } = await client.query(
    `SELECT id FROM agent_runs
     WHERE (status = 'queued') OR (status = 'running' AND lease_expires_at < now())
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
  );
  if (rows.length === 0) return null;
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
    `UPDATE agent_runs SET status = 'queued', cancel_requested = false, updated_at = now() WHERE id = $1`,
    [runId],
  );
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
