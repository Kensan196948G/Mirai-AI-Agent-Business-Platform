import express from 'express';
import { getPool } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyChain } from '../lib/audit.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, actor_type, actor_name, action, resource_type, resource_id, detail, prev_hash, hash, created_at
     FROM audit_log ORDER BY id DESC LIMIT 200`,
  );
  res.json({ audit: rows });
});

router.get('/verify', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, actor_type, actor_name, action, resource_type, resource_id, detail, prev_hash, hash
     FROM audit_log ORDER BY id ASC`,
  );
  const result = verifyChain(rows);
  res.json({ ok: result.ok, count: rows.length, breaks: result.breaks });
});

export default router;
