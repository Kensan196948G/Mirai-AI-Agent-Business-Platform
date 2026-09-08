import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT a.*, ar.run_code, ar.agent_id, u.name AS reviewed_by_name
     FROM artifacts a JOIN agent_runs ar ON ar.id = a.run_id
     LEFT JOIN users u ON u.id = a.reviewed_by
     WHERE a.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'artifact が見つかりません' });
  const { rows: citations } = await getPool().query(
    `SELECT ac.locator, sr.id AS source_record_id, sr.title, sr.canonical_url, sr.evidence_type
     FROM artifact_citations ac JOIN source_records sr ON sr.id = ac.source_record_id
     WHERE ac.artifact_id = $1`,
    [id],
  );
  res.json({ artifact: rows[0], citations });
});

// アプリ内レビュー（人間が草案を確認したことを記録する）。正式なGate承認とは別物。
router.post('/:id/review', requireAuth, requireRole('Administrator', 'Knowledge Curator', 'Reviewer'), async (req, res) => {
  const id = Number(req.params.id);
  const { note } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE artifacts SET review_state = 'reviewed', reviewed_by = $1, reviewed_at = now(), review_note = $2
         WHERE id = $3 AND review_state = 'draft' RETURNING id, review_state`,
        [req.user.id, note || null, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('artifact が見つからないか、既にレビュー済みです'), { status: 409 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'artifact.review', resourceType: 'artifact', resourceId: id, detail: { note },
      });
      return rows[0];
    });
    res.json({ artifact: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
