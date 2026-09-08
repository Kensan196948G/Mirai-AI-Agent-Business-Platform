import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, email, name, dept, role, last_login_at FROM users ORDER BY name`,
  );
  res.json({ users: rows });
});

router.patch('/:id', requireAuth, requireRole('Administrator'), async (req, res) => {
  const id = Number(req.params.id);
  const { role, dept } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });

  const fields = [];
  const values = [];
  let i = 1;
  if (role !== undefined) { fields.push(`role = $${i++}`); values.push(role); }
  if (dept !== undefined) { fields.push(`dept = $${i++}`); values.push(dept); }
  if (fields.length === 0) return res.status(400).json({ error: '更新項目がありません' });

  values.push(id);
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, role, dept`,
        values,
      );
      if (rows.length === 0) throw Object.assign(new Error('user が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'user.update', resourceType: 'user', resourceId: id, detail: { role, dept },
      });
      return rows[0];
    });
    res.json({ user: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
