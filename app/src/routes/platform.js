/**
 * 「プラットフォーム」画面群（Integrations / Observability / Agent・Skill・Model Router）。
 * いずれも実際のAIエージェント実行・外部API連携は行わない、人が設定する管理テーブル。
 */
import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

// --- Integrations ---------------------------------------------------------
router.get('/integrations', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT * FROM integrations ORDER BY id`);
  res.json({ integrations: rows });
});

router.patch('/integrations/:id', requireAuth, requireRole('Administrator'), async (req, res) => {
  const id = req.params.id;
  const { status, detail, note } = req.body || {};
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE integrations SET
           status = COALESCE($1, status), detail = COALESCE($2, detail), note = COALESCE($3, note),
           last_sync_at = now(), updated_at = now()
         WHERE id = $4 RETURNING id, status`,
        [status || null, detail || null, note || null, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('integration が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'integration.update', resourceType: 'integration', resourceId: id, detail: { status },
      });
      return rows[0];
    });
    res.json({ integration: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// --- Agents / Skills / Router ---------------------------------------------
router.get('/agents', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT * FROM agents_config ORDER BY id`);
  res.json({ agents: rows });
});

router.patch('/agents/:id', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const { enabled } = req.body || {};
  const { rows } = await getPool().query(
    `UPDATE agents_config SET enabled = COALESCE($1, enabled), updated_at = now() WHERE id = $2 RETURNING id, enabled`,
    [enabled ?? null, req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'agent が見つかりません' });
  res.json({ agent: rows[0] });
});

router.get('/skills', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT * FROM skills_registry ORDER BY name`);
  res.json({ skills: rows });
});

router.get('/router', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT * FROM model_router ORDER BY sort_order`);
  res.json({ router: rows });
});

// category はスラッシュ等を含む自由記述の値のためURLパスではなくボディで受け取る。
router.patch('/router', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const { category, model } = req.body || {};
  if (!category || !model) return res.status(400).json({ error: 'category, model は必須' });
  const { rows } = await getPool().query(
    `UPDATE model_router SET model = $1, updated_at = now() WHERE category = $2 RETURNING category, model`,
    [model, category],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'category が見つかりません' });
  res.json({ router: rows[0] });
});

// --- Usage（Observability）— tasks から集計。専用テーブルは持たない ---------
router.get('/usage', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT provider, SUM(cost)::float AS cost, SUM(tokens_in + tokens_out)::bigint AS tokens, COUNT(*)::int AS runs
     FROM tasks GROUP BY provider ORDER BY cost DESC`,
  );
  res.json({ usage: rows });
});

export default router;
