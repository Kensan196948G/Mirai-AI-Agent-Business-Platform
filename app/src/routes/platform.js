/**
 * 「プラットフォーム」画面群（Integrations / Observability / Agent・Skill・Model Router）。
 * いずれも実際のAIエージェント実行・外部API連携は行わない、人が設定する管理テーブル。
 */
import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import * as llm from '../lib/llm.js';
import { runtimeStatus, checkConnector } from '../integrations/connectors.js';
import { describeRouter } from '../lib/model-catalog.js';

const router = express.Router();

// --- Integrations ---------------------------------------------------------
router.get('/integrations', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT * FROM integrations ORDER BY id`);
  // 実際の設定状況（環境変数の有無・仕様確認状況）を添える。値は含めない
  res.json({ integrations: rows.map((r) => ({ ...r, runtime: runtimeStatus(r.id) })) });
});

/**
 * 読み取り専用の疎通確認（D-20〜D-23）。手動で connected にする手段は無く、確認に成功した場合だけ connected へ更新する。
 * 未設定・仕様未確認・失敗は attention のまま理由を detail に残す（未接続を成功表示しない）。
 */
router.post('/integrations/:id/check', requireAuth, requireRole('Administrator'), async (req, res) => {
  const id = req.params.id;
  const result = await checkConnector(id);
  try {
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE integrations SET status = $1, detail = $2, last_sync_at = CASE WHEN $3 THEN now() ELSE last_sync_at END, updated_at = now()
         WHERE id = $4 RETURNING id, status, detail, last_sync_at`,
        [result.ok ? 'connected' : 'attention', result.detail, result.checked === true, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('integration が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'integration.check', resourceType: 'integration', resourceId: id, detail: { ok: result.ok, checked: result.checked === true, detail: result.detail },
      });
      return rows[0];
    });
    res.json({ integration: { ...updated, runtime: runtimeStatus(id) }, check: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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
  // 各 category の解決結果（Provider / モデル / 設定状況 / フォールバック理由）を添える。秘密は含まない
  const rows = await describeRouter(getPool());
  res.json({ router: rows, providers: llm.providerInfo() });
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
  const llmSpent = llm.isConfigured() ? await llm.currentMonthSpend(getPool()) : 0;
  res.json({
    usage: rows,
    llm: { configured: llm.isConfigured(), monthlySpent: llmSpent, monthlyCap: llm.monthlyCapUsd(), defaultProvider: llm.defaultProvider() || null, providers: llm.configuredProviders() },
  });
});

export default router;
