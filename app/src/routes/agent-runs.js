import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import * as registry from '../agent-runtime/registry.js';
import * as jobStore from '../agent-runtime/job-store.js';
import { PolicyDeniedError } from '../agent-runtime/policy-engine.js';
import { createRunForUser, AGENT_INPUT_ALLOWLIST } from '../agent-runtime/run-create.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { agentId, projectId, input } = req.body || {};
  if (!agentId || !AGENT_INPUT_ALLOWLIST[agentId]) {
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

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.run_code, ar.agent_id, ar.status, ar.current_step, ar.max_steps, ar.project_id,
            ar.created_at, ar.finished_at, ar.error_message, u.name AS requested_by_name, p.project_code
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     ORDER BY ar.created_at DESC LIMIT 100`,
  );
  res.json({ runs: rows });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT ar.*, u.name AS requested_by_name, p.project_code
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     WHERE ar.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'run が見つかりません' });
  const { rows: artifacts } = await getPool().query(
    `SELECT id, artifact_code, kind, title, review_state, created_at FROM artifacts WHERE run_id = $1 ORDER BY id`,
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
