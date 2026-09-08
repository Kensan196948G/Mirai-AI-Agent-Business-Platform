import express from 'express';
import { getPool } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/:id/versions', requireAuth, async (req, res) => {
  const { rows } = await getPool().query(
    `SELECT sv.id, sv.skill_id, sv.version, sv.content_hash, sv.status, sv.risk, sv.approved_at, u.name AS approved_by_name
     FROM skill_versions sv LEFT JOIN users u ON u.id = sv.approved_by
     WHERE sv.skill_id = $1 ORDER BY sv.created_at DESC`,
    [req.params.id],
  );
  res.json({ versions: rows });
});

export default router;
