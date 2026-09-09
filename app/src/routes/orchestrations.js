/**
 * 司令塔（CTO Orchestrator）API。
 *  POST /api/orchestrations            要求文から計画を作り、実行を開始（ロール・上限は Run 作成と同じ）
 *  GET  /api/orchestrations            一覧
 *  GET  /api/orchestrations/:id        計画・Step・Run・統合草案
 *  POST /api/orchestrations/:id/cancel 中断要求（配下の Run にも伝播）
 */
import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { authorizeRunStart, PolicyDeniedError } from '../agent-runtime/policy-engine.js';
import { createOrchestration, advanceOrchestration } from '../agent-runtime/orchestrator.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { request, projectId } = req.body || {};
  if (!request || typeof request !== 'string' || !request.trim() || request.length > 4000) return res.status(400).json({ error: 'request（1〜4000 文字）は必須' });
  try {
    authorizeRunStart({ user: req.user });
  } catch (err) {
    return res.status(err instanceof PolicyDeniedError ? 403 : 500).json({ error: err.message });
  }
  try {
    const orch = await withTransaction((client) => createOrchestration(client, { user: req.user, requestText: request.trim(), projectId: projectId || null }));
    res.status(201).json({ orchestration: orch });
  } catch (err) {
    if (err instanceof PolicyDeniedError) return res.status(err.code === 'concurrency' ? 409 : 403).json({ error: err.message });
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT o.id, o.orchestration_code, o.request_text, o.intent, o.risk, o.plan_source, o.status, o.cost_usd, o.budget_usd, o.created_at, o.finished_at,
            u.name AS requested_by_name, (SELECT count(*)::int FROM orchestration_steps s WHERE s.orchestration_id = o.id) AS step_count
     FROM orchestrations o JOIN users u ON u.id = o.requested_by ORDER BY o.created_at DESC LIMIT 100`,
  );
  res.json({ orchestrations: rows });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  // 進行中なら最新状態へ前進させてから返す（Worker のポーリングを待たない）
  const orch = await withTransaction((client) => advanceOrchestration(client, id));
  if (!orch) return res.status(404).json({ error: 'orchestration が見つかりません' });
  const { rows: steps } = await getPool().query(
    `SELECT s.*, r.run_code, r.status AS run_status, r.current_step, r.error_message AS run_error
     FROM orchestration_steps s LEFT JOIN agent_runs r ON r.id = s.run_id WHERE s.orchestration_id = $1 ORDER BY s.seq`,
    [id],
  );
  const { rows: art } = orch.final_artifact_id ? await getPool().query(`SELECT id, artifact_code, title, content, review_state, expert_review_required, ai_completion_prohibited FROM artifacts WHERE id = $1`, [orch.final_artifact_id]) : { rows: [] };
  const { rows: u } = await getPool().query(`SELECT name FROM users WHERE id = $1`, [orch.requested_by]);
  res.json({ orchestration: { ...orch, requested_by_name: u[0]?.name || '' }, steps, final_artifact: art[0] || null });
});

router.post('/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT id, requested_by, status FROM orchestrations WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('orchestration が見つかりません'), { status: 404 });
      if (Number(rows[0].requested_by) !== Number(req.user.id) && req.user.role !== 'Administrator') throw Object.assign(new Error('この司令塔実行を中断する権限がありません'), { status: 403 });
      if (['completed', 'partial', 'failed', 'cancelled', 'blocked'].includes(rows[0].status)) throw Object.assign(new Error(`既に終了しています（現在: ${rows[0].status}）`), { status: 409 });
      await client.query(`UPDATE orchestrations SET cancel_requested = true, updated_at = now() WHERE id = $1`, [id]);
      await recordAudit(client, { actorId: req.user.id, actorType: 'user', actorName: req.user.name, action: 'orchestration.cancel_requested', resourceType: 'orchestration', resourceId: id, detail: {} });
      return advanceOrchestration(client, id);
    });
    res.json({ orchestration: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
