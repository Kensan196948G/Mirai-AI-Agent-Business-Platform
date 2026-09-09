import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, canViewAll } from '../middleware/auth.js';
import { parsePage, pageInfo } from '../lib/pagination.js';
import { recordAudit } from '../lib/audit.js';
import * as registry from '../agent-runtime/registry.js';
import * as jobStore from '../agent-runtime/job-store.js';
import { PolicyDeniedError, authorizeRunStart } from '../agent-runtime/policy-engine.js';
import { createRunForUser, inputKeysFor } from '../agent-runtime/run-create.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { agentId, projectId, input } = req.body || {};
  if (!agentId || !inputKeysFor(agentId)) {
    return res.status(400).json({ error: '不正な agentId' });
  }
  try {
    const result = await withTransaction((client) => createRunForUser(client, { user: req.user, agentId, projectId, input, via: 'api' }));
    res.status(201).json({ run: result });
  } catch (err) {
    // ロール不足・並行実行上限は 403 / 409 として利用者に理由を返す（Policy の拒否は監査対象の正常系）
    if (err instanceof PolicyDeniedError) return res.status(err.code === 'concurrency' ? 409 : 403).json({ error: err.message });
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  let page;
  try { page = parsePage(req.query, { defaultLimit: 100 }); } catch (err) { return res.status(400).json({ error: err.message }); }
  // IDOR スコープ: 監督系ロール以外は自分が起案した Run だけ
  const scope = canViewAll(req.user) ? 'true' : 'ar.requested_by = $3';
  const params = [page.limit, page.offset, ...(canViewAll(req.user) ? [] : [req.user.id])];
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.run_code, ar.agent_id, ar.status, ar.current_step, ar.max_steps, ar.project_id,
            ar.created_at, ar.finished_at, ar.error_message, u.name AS requested_by_name, p.project_code,
            count(*) OVER() AS total
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     WHERE ${scope}
     ORDER BY ar.created_at DESC LIMIT $1 OFFSET $2`, params,
  );
  const total = rows[0]?.total ?? (await getPool().query(`SELECT count(*)::int AS n FROM agent_runs ar WHERE ${scope.replace('$3', '$1')}`, params.slice(2))).rows[0].n;
  res.json({ runs: rows.map(({ total: _t, ...r }) => r), page: pageInfo(page, total) });
});

/** 個別取得のスコープ判定: 監督系ロール以外は自分の Run だけ。存在を漏らさないため他人のものは 404。 */
async function loadScopedRun(client, id, user, columns = 'id, requested_by') {
  const { rows } = await client.query(`SELECT ${columns} FROM agent_runs WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  if (!canViewAll(user) && Number(rows[0].requested_by) !== Number(user.id)) return null;
  return rows[0];
}

/**
 * 業務Agent の実測 KPI（C-17）。推定値や係数は使わず、agent_runs / run_events / artifacts の実データだけを集計する。
 * range: 24h | 7d | 30d | all（created_at 基準）
 */
const RANGES = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', all: null };
router.get('/metrics', requireAuth, async (req, res) => {
  const range = Object.prototype.hasOwnProperty.call(RANGES, req.query.range) ? req.query.range : '30d';
  const interval = RANGES[range];
  const params = interval ? [interval] : [];
  const where = interval ? `r.created_at >= now() - ($1 || '')::interval` : 'true';
  const { rows: byAgent } = await getPool().query(
    `WITH runs AS (
       SELECT r.id, r.agent_id, r.status, r.current_step, r.created_at, r.finished_at,
              COALESCE(u.cost, 0) AS cost, COALESCE(u.tokens, 0) AS tokens, COALESCE(u.degraded, 0) AS degraded
       FROM agent_runs r
       LEFT JOIN LATERAL (
         SELECT SUM(e.cost)::float AS cost, SUM(COALESCE(e.tokens_in,0) + COALESCE(e.tokens_out,0))::bigint AS tokens,
                count(*) FILTER (WHERE e.type = 'llm_degraded')::int AS degraded
         FROM run_events e WHERE e.run_id = r.id
       ) u ON true
       WHERE ${where}
     ), arts AS (
       SELECT r.agent_id, count(*)::int AS artifacts, count(*) FILTER (WHERE a.review_state = 'reviewed')::int AS reviewed
       FROM artifacts a JOIN runs r ON r.id = a.run_id GROUP BY r.agent_id
     )
     SELECT runs.agent_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE status IN ('queued','running'))::int AS active,
            count(*) FILTER (WHERE status IN ('waiting_approval','paused'))::int AS waiting,
            AVG(current_step) FILTER (WHERE status = 'completed')::float AS avg_steps,
            AVG(cost)::float AS avg_cost, SUM(cost)::float AS total_cost, AVG(tokens)::float AS avg_tokens,
            AVG(EXTRACT(EPOCH FROM (finished_at - created_at))) FILTER (WHERE status = 'completed')::float AS avg_duration_s,
            SUM(degraded)::int AS degraded,
            MAX(created_at) AS last_run_at,
            COALESCE(MAX(arts.artifacts), 0)::int AS artifacts, COALESCE(MAX(arts.reviewed), 0)::int AS reviewed
     FROM runs LEFT JOIN arts ON arts.agent_id = runs.agent_id
     GROUP BY runs.agent_id ORDER BY runs.agent_id`,
    params,
  );
  const { rows: byStatus } = await getPool().query(
    `SELECT status, count(*)::int AS n FROM agent_runs r WHERE ${where} GROUP BY status`, params,
  );
  const { rows: chat } = await getPool().query(
    `SELECT COALESCE(SUM(cost), 0)::float AS cost FROM chat_messages m WHERE ${interval ? `m.created_at >= now() - ($1 || '')::interval` : 'true'}`, params,
  );
  const agents = byAgent.map((a) => ({
    ...a,
    completion_rate: a.total ? a.completed / a.total : null,
    review_rate: a.artifacts ? a.reviewed / a.artifacts : null,
  }));
  const totals = agents.reduce((acc, a) => ({
    total: acc.total + a.total, completed: acc.completed + a.completed, failed: acc.failed + a.failed, active: acc.active + a.active, waiting: acc.waiting + a.waiting,
    total_cost: acc.total_cost + (a.total_cost || 0), artifacts: acc.artifacts + a.artifacts, reviewed: acc.reviewed + a.reviewed, degraded: acc.degraded + a.degraded,
  }), { total: 0, completed: 0, failed: 0, active: 0, waiting: 0, total_cost: 0, artifacts: 0, reviewed: 0, degraded: 0 });
  res.json({
    range, agents, by_status: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
    totals: { ...totals, completion_rate: totals.total ? totals.completed / totals.total : null, review_rate: totals.artifacts ? totals.reviewed / totals.artifacts : null, chat_cost: chat[0].cost, ai_cost: totals.total_cost + chat[0].cost },
  });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT ar.*, u.name AS requested_by_name, p.project_code
     , ro.run_code AS rerun_of_run_code
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     LEFT JOIN agent_runs ro ON ro.id = ar.rerun_of_run_id
     WHERE ar.id = $1`,
    [id],
  );
  if (rows.length === 0 || (!canViewAll(req.user) && Number(rows[0].requested_by) !== Number(req.user.id))) return res.status(404).json({ error: 'run が見つかりません' });
  const { rows: artifacts } = await getPool().query(
    `SELECT id, artifact_code, kind, title, review_state, created_at, expert_review_required, ai_completion_prohibited FROM artifacts WHERE run_id = $1 ORDER BY id`,
    [id],
  );
  let approval = null;
  if (rows[0].approval_request_id) {
    const { rows: apr } = await getPool().query(
      `SELECT id, approval_code, status, target, risk, created_at, decided_at FROM approval_requests WHERE id = $1`,
      [rows[0].approval_request_id],
    );
    approval = apr[0] || null;
  }
  res.json({ run: rows[0], artifacts, approval });
});

router.get('/:id/events', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (!(await loadScopedRun(getPool(), id, req.user))) return res.status(404).json({ error: 'run が見つかりません' });
  const { rows } = await getPool().query(
    `SELECT seq, type, skill_id, skill_version, tool_name, status, detail, tokens_in, tokens_out, cost, created_at
     FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [id],
  );
  res.json({ events: rows });
});

router.post('/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT requested_by, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (Number(rows[0].requested_by) !== Number(req.user.id) && req.user.role !== 'Administrator') {
        throw Object.assign(new Error('この Run をキャンセルする権限がありません'), { status: 403 });
      }
      if (['completed', 'failed', 'cancelled'].includes(rows[0].status)) {
        throw Object.assign(new Error(`既に終了しています（現在: ${rows[0].status}）`), { status: 409 });
      }
      await jobStore.requestCancel(client, id);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.cancel_requested', resourceType: 'agent_run', resourceId: id, detail: {},
      });
      return { id, cancel_requested: true };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 同じ入力で再実行する（系譜: rerun_of_run_id）。作成の検証・上限・監査は通常の作成と同じ。
router.post('/:id/rerun', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      authorizeRunStart({ user: req.user }); // ロール上 Run を開始できない利用者は対象の有無に関係なく 403
      const { rows } = await client.query(`SELECT id, run_code, agent_id, project_id, input_json, status, requested_by FROM agent_runs WHERE id = $1`, [id]);
      if (rows.length > 0 && !canViewAll(req.user) && Number(rows[0].requested_by) !== Number(req.user.id)) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (!['completed', 'failed', 'cancelled'].includes(rows[0].status)) {
        throw Object.assign(new Error(`終了した Run のみ再実行できます（現在: ${rows[0].status}）`), { status: 409 });
      }
      const run = await createRunForUser(client, { user: req.user, agentId: rows[0].agent_id, projectId: rows[0].project_id, input: rows[0].input_json, via: 'rerun' });
      await client.query(`UPDATE agent_runs SET rerun_of_run_id = $1 WHERE id = $2`, [id, run.id]);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.rerun', resourceType: 'agent_run', resourceId: run.id, detail: { rerunOf: rows[0].run_code, runCode: run.run_code },
      });
      return { ...run, rerun_of_run_id: id };
    });
    res.status(201).json({ run: result });
  } catch (err) {
    if (err instanceof PolicyDeniedError) return res.status(err.code === 'concurrency' ? 409 : 403).json({ error: err.message });
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 一時停止要求。Worker は Step 境界で確認し、実行中の Step を終えてから paused へ遷移する（Lease を手放す）。
router.post('/:id/pause', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT requested_by, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (Number(rows[0].requested_by) !== Number(req.user.id) && req.user.role !== 'Administrator') {
        throw Object.assign(new Error('この Run を一時停止する権限がありません'), { status: 403 });
      }
      if (!['queued', 'running'].includes(rows[0].status)) {
        throw Object.assign(new Error(`一時停止できない状態です（現在: ${rows[0].status}）`), { status: 409 });
      }
      if (rows[0].status === 'queued') {
        // まだ Worker が拾っていなければ即座に paused にできる
        await jobStore.pauseRun(client, id, '利用者の一時停止要求');
        await jobStore.appendEvent(client, id, { type: 'paused', status: 'paused', detail: { reason: '利用者の一時停止要求', immediate: true } });
      } else {
        await jobStore.requestPause(client, id);
      }
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.pause_requested', resourceType: 'agent_run', resourceId: id, detail: { from: rows[0].status },
      });
      return { id, pause_requested: true, status: rows[0].status === 'queued' ? 'paused' : 'running' };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/resume', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT status, agent_id, requested_by, approval_request_id FROM agent_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (!['paused', 'waiting_approval'].includes(rows[0].status)) {
        throw Object.assign(new Error(`再開できない状態です（現在: ${rows[0].status}）`), { status: 409 });
      }
      if (Number(rows[0].requested_by) !== Number(req.user.id) && req.user.role !== 'Administrator') {
        throw Object.assign(new Error('この Run を再開する権限がありません'), { status: 403 });
      }
      // 承認待ちの Run は、紐づく承認が approved になるまで手動でも再開できない（承認の迂回を防ぐ）
      if (rows[0].status === 'waiting_approval' && rows[0].approval_request_id) {
        const { rows: apr } = await client.query(`SELECT status, approval_code FROM approval_requests WHERE id = $1`, [rows[0].approval_request_id]);
        if (!apr[0] || apr[0].status !== 'approved') {
          throw Object.assign(new Error(`承認（${apr[0]?.approval_code || '不明'}）が ${apr[0]?.status || '未確定'} のため再開できません`), { status: 409 });
        }
      }
      // 再開時は権限・承認済み版を再検証する（版が失効していれば queued へ戻さない）。
      const agentVersionInfo = await registry.getApprovedAgentVersion(client, rows[0].agent_id);
      if (!agentVersionInfo) {
        throw Object.assign(new Error('Agentの承認済み版が失効しているため再開できません'), { status: 409 });
      }
      await jobStore.resumeRun(client, id);
      await jobStore.appendEvent(client, id, { type: 'resumed', status: 'ok', detail: { by: 'user', from: rows[0].status } });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.resume', resourceType: 'agent_run', resourceId: id, detail: { from: rows[0].status },
      });
      return { id, status: 'queued' };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
