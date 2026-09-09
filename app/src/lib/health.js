import { circuitStatus } from '../agent-runtime/circuit-breaker.js';
/**
 * 稼働監視用の集約（A-5）。/api/health と watchdog.mjs が共用する。
 * - worker.alive: いずれかの Worker の last_seen_at が閾値以内
 * - queue.oldest_queued_age_s: 最古の queued Run の経過秒（Worker が拾えていない滞留の検知）
 */
export const WORKER_STALE_SECONDS = Number(process.env.AGENT_WORKER_STALE_SECONDS || 90);
export const QUEUE_BACKLOG_SECONDS = Number(process.env.AGENT_QUEUE_BACKLOG_SECONDS || 600);

export async function collectHealth(client) {
  const { rows: w } = await client.query(
    `SELECT worker_id, hostname, pid, last_seen_at, runs_claimed,
            EXTRACT(EPOCH FROM (now() - last_seen_at))::int AS age_s
     FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 10`,
  );
  const { rows: q } = await client.query(
    `SELECT count(*)::int AS queued,
            COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int, 0) AS oldest_queued_age_s
     FROM agent_runs WHERE status = 'queued'`,
  );
  const { rows: r } = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'running')::int AS running,
            count(*) FILTER (WHERE status = 'running' AND lease_expires_at < now())::int AS lease_expired
     FROM agent_runs`,
  );
  const alive = w.filter((x) => x.age_s <= WORKER_STALE_SECONDS);
  const backlog = q[0].queued > 0 && q[0].oldest_queued_age_s > QUEUE_BACKLOG_SECONDS;
  return {
    worker: {
      alive: alive.length > 0,
      alive_count: alive.length,
      stale_after_s: WORKER_STALE_SECONDS,
      workers: w.map((x) => ({ worker_id: x.worker_id, hostname: x.hostname, pid: x.pid, age_s: x.age_s, runs_claimed: x.runs_claimed })),
    },
    queue: { queued: q[0].queued, oldest_queued_age_s: q[0].oldest_queued_age_s, backlog, backlog_after_s: QUEUE_BACKLOG_SECONDS },
    runs: { running: r[0].running, lease_expired: r[0].lease_expired },
    llm_circuit: circuitStatus(),
  };
}

/** 監視上の総合判定。degraded の理由を配列で返す（空なら正常）。 */
export function evaluateHealth(h) {
  const problems = [];
  if (!h.worker.alive) problems.push(`Worker が ${h.worker.stale_after_s}s 以上ハートビートを送っていません`);
  if (h.queue.backlog) problems.push(`queued の Run が ${h.queue.oldest_queued_age_s}s 滞留しています（閾値 ${h.queue.backlog_after_s}s）`);
  if (h.runs.lease_expired > 0) problems.push(`Lease 期限切れの running Run が ${h.runs.lease_expired} 件あります`);
  for (const p of (h.llm_circuit && h.llm_circuit.open) || []) problems.push(`LLM Provider「${p}」は連続失敗のため circuit open（${h.llm_circuit.providers[p].opened_until} まで）`);
  return problems;
}
