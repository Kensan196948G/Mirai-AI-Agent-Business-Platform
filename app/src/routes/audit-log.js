import express from 'express';
import { getPool } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { parsePage, pageInfo } from '../lib/pagination.js';
import { verifyChain, verifyAnchors, CURRENT_HASH_VERSION } from '../lib/audit.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  let page;
  try { page = parsePage(req.query, { defaultLimit: 200 }); } catch (err) { return res.status(400).json({ error: err.message }); }
  const { rows } = await getPool().query(
    `SELECT id, actor_type, actor_name, action, resource_type, resource_id, detail, prev_hash, hash, created_at, count(*) OVER() AS total
     FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2`, [page.limit, page.offset],
  );
  const total = rows[0]?.total ?? (await getPool().query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
  res.json({ audit: rows.map(({ total: _t, ...r }) => r), page: pageInfo(page, total) });
});

router.get('/verify', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, actor_type, actor_name, action, resource_type, resource_id, detail, prev_hash, hash, hash_version
     FROM audit_log ORDER BY id ASC`,
  );
  const result = verifyChain(rows);
  const anchors = await verifyAnchors(getPool());
  res.json({
    ok: result.ok && anchors.ok, count: rows.length, breaks: result.breaks, versions: result.versions, current_hash_version: CURRENT_HASH_VERSION,
    anchors: { ok: anchors.ok, count: anchors.anchors, problems: anchors.problems, latest: anchors.latest ? { id: Number(anchors.latest.id), created_at: anchors.latest.created_at, last_audit_id: Number(anchors.latest.last_audit_id), chain_ok: anchors.latest.chain_ok, external_ref: anchors.latest.external_ref } : null },
  });
});

router.get('/anchors', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(`SELECT id, last_audit_id, entry_count, anchor_hash, chain_ok, external_ref, created_at FROM audit_anchors ORDER BY id DESC LIMIT 60`);
  res.json({ anchors: rows });
});

export default router;
