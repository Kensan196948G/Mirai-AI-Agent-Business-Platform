import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { nextKcCode } from '../lib/codes.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT k.id, k.kc_code, k.title, k.type, k.score, k.status, k.summary, k.source, k.duplicate_note, k.notion_ref, k.created_at,
            p.project_code
     FROM knowledge_candidates k LEFT JOIN projects p ON p.id = k.project_id
     ORDER BY k.created_at DESC`,
  );
  res.json({ knowledge: rows });
});

router.post('/', requireAuth, requireRole('Administrator', 'Knowledge Curator'), async (req, res) => {
  const { title, type, projectId, score, summary, source } = req.body || {};
  if (!title || !type) return res.status(400).json({ error: 'title, type は必須' });
  try {
    const result = await withTransaction(async (client) => {
      const kcCode = await nextKcCode(client);
      const { rows } = await client.query(
        `INSERT INTO knowledge_candidates (kc_code, title, type, project_id, score, summary, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, kc_code, title, status`,
        [kcCode, title, type, projectId || null, score || 0, summary || '', source || ''],
      );
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'knowledge.create', resourceType: 'knowledge', resourceId: rows[0].id, detail: { kcCode },
      });
      return rows[0];
    });
    res.status(201).json({ knowledge: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/:id', requireAuth, requireRole('Administrator', 'Knowledge Curator'), async (req, res) => {
  const id = Number(req.params.id);
  const { status, notionRef } = req.body || {};
  if (!Number.isInteger(id) || !['promoted', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status は pending/promoted/rejected のいずれか' });
  }
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE knowledge_candidates SET status = $1, notion_ref = COALESCE($2, notion_ref) WHERE id = $3 RETURNING id, status`,
        [status, notionRef || null, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('knowledge が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: `knowledge.${status}`, resourceType: 'knowledge', resourceId: id, detail: {},
      });
      return rows[0];
    });
    res.json({ knowledge: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
