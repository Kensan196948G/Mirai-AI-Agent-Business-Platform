/**
 * 出典（source_records）のレビュー API（B-8〜B-11）。
 * 取り込み自体は ingest-sources.mjs（運用バッチ）で行い、ここでは一覧・承認・隔離・失効だけを扱う。
 * Agent Run から参照されるのは status='approved' かつ有効期限内の行のみ（policy-engine / tool-gateway）。
 */
import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parsePage, pageInfo } from '../lib/pagination.js';
import { listSources, approveSource, quarantineSource, retireSource, REVIEW_ROLES, SOURCE_STATUSES } from '../lib/source-ops.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { status, source_type: sourceType } = req.query;
  if (status && !SOURCE_STATUSES.includes(String(status))) return res.status(400).json({ error: '不正な status' });
  let page;
  try { page = parsePage(req.query, { defaultLimit: 200 }); } catch (err) { return res.status(400).json({ error: err.message }); }
  const rows = await listSources(getPool(), { status: status ? String(status) : null, sourceType: sourceType ? String(sourceType) : null, limit: page.limit, offset: page.offset });
  const { rows: counts } = await getPool().query(`SELECT status, count(*)::int AS n FROM source_records GROUP BY status`);
  const { rows: tot } = await getPool().query(`SELECT count(*)::int AS n FROM source_records WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR source_type = $2)`, [status ? String(status) : null, sourceType ? String(sourceType) : null]);
  res.json({ sources: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), page: pageInfo(page, tot[0].n) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT s.*, u.name AS ingested_by_name, r.name AS reviewer_name
     FROM source_records s LEFT JOIN users u ON u.id = s.ingested_by LEFT JOIN users r ON r.id = s.reviewer_id WHERE s.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'source_record が見つかりません' });
  res.json({ source: rows[0] });
});

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  throw err;
}

router.post('/:id/approve', requireAuth, requireRole(...REVIEW_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { note, allowSelfReview } = req.body || {};
  try {
    const result = await withTransaction((client) => approveSource(client, { id, reviewer: req.user, allowSelfReview: allowSelfReview === true, note }));
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/:id/quarantine', requireAuth, requireRole(...REVIEW_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (!reason) return res.status(400).json({ error: 'reason は必須' });
  try {
    res.json(await withTransaction((client) => quarantineSource(client, { id, reviewer: req.user, reason })));
  } catch (err) { handleError(res, err); }
});

router.post('/:id/retire', requireAuth, requireRole(...REVIEW_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const { effectiveTo, reason } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveTo || ''))) return res.status(400).json({ error: 'effectiveTo は YYYY-MM-DD' });
  try {
    res.json(await withTransaction((client) => retireSource(client, { id, reviewer: req.user, effectiveTo, reason })));
  } catch (err) { handleError(res, err); }
});

export default router;
