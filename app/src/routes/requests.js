import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { nextRequestCode, nextProjectCode } from '../lib/codes.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title, description は必須' });

  const result = await withTransaction(async (client) => {
    const code = await nextRequestCode(client);
    const { rows } = await client.query(
      `INSERT INTO requests (request_code, title, description, requester_id)
       VALUES ($1, $2, $3, $4) RETURNING id, request_code, title, description, status, created_at`,
      [code, title, description, req.user.id],
    );
    await recordAudit(client, {
      actorId: req.user.id, actorType: 'user', actorName: req.user.name,
      action: 'request.create', resourceType: 'request', resourceId: rows[0].id, detail: { code },
    });
    return rows[0];
  });

  res.status(201).json({ request: result });
});

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT r.id, r.request_code, r.title, r.description, r.status, r.created_at,
            u.name AS requester_name
     FROM requests r JOIN users u ON u.id = r.requester_id
     ORDER BY r.created_at DESC`,
  );
  res.json({ requests: rows });
});

router.post('/:id/promote', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: '不正な id' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: reqRows } = await client.query(
        `SELECT id, title, description, status FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (reqRows.length === 0) throw Object.assign(new Error('request が見つかりません'), { status: 404 });
      if (reqRows[0].status !== 'submitted') {
        throw Object.assign(new Error(`昇格できない状態です（現在: ${reqRows[0].status}）`), { status: 409 });
      }

      const projectCode = await nextProjectCode(client);
      const { rows: projRows } = await client.query(
        `INSERT INTO projects (project_code, title, description, request_id, created_by, owner_id, status)
         VALUES ($1, $2, $3, $4, $5, $5, 'idea') RETURNING id, project_code, title, description, status, created_at`,
        [projectCode, reqRows[0].title, reqRows[0].description, requestId, req.user.id],
      );

      await client.query(`UPDATE requests SET status = 'promoted' WHERE id = $1`, [requestId]);

      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'request.promote', resourceType: 'project', resourceId: projRows[0].id,
        detail: { request_id: requestId },
      });

      return { project: projRows[0] };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
