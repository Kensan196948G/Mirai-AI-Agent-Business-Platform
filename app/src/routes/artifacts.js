import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { diffArtifacts, lineageOf, integrityOf, contentHash } from '../lib/artifact-lineage.js';
import { createHash } from 'node:crypto';

const REVIEW_ROLES = ['Administrator', 'Knowledge Curator', 'Reviewer', 'Approver'];
const CHECK_KINDS = new Set(['unknown', 'assumption', 'finding', 'flag']);
const itemHash = (text) => createHash('sha256').update(String(text)).digest('hex');

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
  // 系譜の直前（同じ Agent・種別・入力の前回成果物）との差分と、レビュー後の版固定の検証結果を添える
  let previous = null, diff = null;
  if (rows[0].previous_artifact_id) {
    const { rows: prev } = await getPool().query(
      `SELECT a.id, a.artifact_code, a.lineage_version, a.review_state, a.content, r.run_code FROM artifacts a JOIN agent_runs r ON r.id = a.run_id WHERE a.id = $1`,
      [rows[0].previous_artifact_id],
    );
    if (prev[0]) {
      previous = { id: Number(prev[0].id), artifact_code: prev[0].artifact_code, lineage_version: prev[0].lineage_version, review_state: prev[0].review_state, run_code: prev[0].run_code };
      diff = diffArtifacts(prev[0].content, rows[0].content);
    }
  }
  const { rows: revs } = await getPool().query(`SELECT count(*)::int AS n FROM artifact_revisions WHERE artifact_id = $1`, [id]);
  // 項目別チェック（不明点ごとの「確認済み」）。本文の項目テキストと item_hash で突き合わせる
  const { rows: checks } = await getPool().query(
    `SELECT c.item_kind, c.item_hash, c.item_text, c.checked, c.note, c.checked_at, u.name AS checked_by_name
     FROM artifact_checks c LEFT JOIN users u ON u.id = c.checked_by WHERE c.artifact_id = $1`,
    [id],
  );
  const content = rows[0].content || {};
  const unknowns = Array.isArray(content.unknowns) ? content.unknowns : [];
  const checkedUnknowns = unknowns.filter((u) => checks.some((c) => c.item_kind === 'unknown' && c.item_hash === itemHash(u) && c.checked)).length;
  res.json({ artifact: rows[0], citations, previous, diff, revisions: revs[0].n, integrity: integrityOf(rows[0]), checks, check_summary: { unknowns_total: unknowns.length, unknowns_checked: checkedUnknowns } });
});

/**
 * 項目別チェックの更新（G-36）。不明点・仮定・事実・要注意の各項目を「確認済み」にし、メモを残す。
 * 成果物本体は変更しない（レビュー済みの版固定に影響しない）。監査に記録。
 */
router.put('/:id/checks', requireAuth, requireRole(...REVIEW_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const { kind, text, checked, note } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (!CHECK_KINDS.has(kind) || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'kind（unknown/assumption/finding/flag）と text は必須' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows: art } = await client.query(`SELECT id, content FROM artifacts WHERE id = $1`, [id]);
      if (art.length === 0) throw Object.assign(new Error('artifact が見つかりません'), { status: 404 });
      const listKey = { unknown: 'unknowns', assumption: 'assumptions', finding: 'findings', flag: 'flags' }[kind];
      const items = Array.isArray(art[0].content?.[listKey]) ? art[0].content[listKey] : [];
      if (!items.includes(text)) throw Object.assign(new Error('その項目は成果物に存在しません'), { status: 409 });
      const isChecked = checked === true;
      const { rows } = await client.query(
        `INSERT INTO artifact_checks (artifact_id, item_kind, item_hash, item_text, checked, note, checked_by, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5 THEN now() ELSE NULL END)
         ON CONFLICT (artifact_id, item_kind, item_hash) DO UPDATE SET
           checked = EXCLUDED.checked, note = COALESCE(EXCLUDED.note, artifact_checks.note), checked_by = EXCLUDED.checked_by,
           checked_at = CASE WHEN EXCLUDED.checked THEN now() ELSE NULL END, updated_at = now()
         RETURNING item_kind, item_hash, checked, note, checked_at`,
        [id, kind, itemHash(text), text, isChecked, note ?? null, req.user.id],
      );
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'artifact.check', resourceType: 'artifact', resourceId: id, detail: { kind, item_hash: rows[0].item_hash, checked: isChecked, note: note ?? null },
      });
      return rows[0];
    });
    res.json({ check: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** 系譜（同じ相談の再実行で作られた成果物の連なり）と、この成果物の書き直し履歴。 */
router.get('/:id/history', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const lineage = await lineageOf(getPool(), id);
  if (lineage.length === 0) return res.status(404).json({ error: 'artifact が見つかりません' });
  const { rows: revisions } = await getPool().query(
    `SELECT id, revision, title, content_hash, reason, created_at FROM artifact_revisions WHERE artifact_id = $1 ORDER BY revision`,
    [id],
  );
  res.json({ lineage: lineage.map((a) => ({ ...a, id: Number(a.id), run_id: Number(a.run_id) })), revisions });
});

/** 任意の 2 成果物の差分（既定は系譜の直前）。 */
router.get('/:id/diff', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(`SELECT id, artifact_code, content, previous_artifact_id FROM artifacts WHERE id = $1`, [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'artifact が見つかりません' });
  const againstId = req.query.against ? Number(req.query.against) : (rows[0].previous_artifact_id ? Number(rows[0].previous_artifact_id) : null);
  if (!Number.isInteger(againstId)) return res.json({ artifact_id: id, against: null, diff: null });
  const { rows: other } = await getPool().query(`SELECT id, artifact_code, content FROM artifacts WHERE id = $1`, [againstId]);
  if (other.length === 0) return res.status(404).json({ error: '比較対象の artifact が見つかりません' });
  res.json({ artifact_id: id, against: { id: againstId, artifact_code: other[0].artifact_code }, diff: diffArtifacts(other[0].content, rows[0].content) });
});

// アプリ内レビュー（人間が草案を確認したことを記録する）。正式なGate承認とは別物。
router.post('/:id/review', requireAuth, requireRole('Administrator', 'Knowledge Curator', 'Reviewer'), async (req, res) => {
  const id = Number(req.params.id);
  const { note, expert_confirmed: expertConfirmed, expert_note: expertNote } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      // レビュー時点の内容ハッシュを固定する（以後の上書きは write-draft が拒否し、改変は integrity で検出できる）
      const { rows: cur } = await client.query(`SELECT content, expert_review_required, ai_completion_prohibited FROM artifacts WHERE id = $1 AND review_state = 'draft' FOR UPDATE`, [id]);
      if (cur.length === 0) throw Object.assign(new Error('artifact が見つからないか、既にレビュー済みです'), { status: 409 });
      // 技術リスク T3 以上: 専門技術者の確認（expert_confirmed）が無ければレビュー済みにできない。Knowledge Curator は技術レビューの権限を持たない
      if (cur[0].expert_review_required) {
        if (!['Administrator', 'Reviewer'].includes(req.user.role)) throw Object.assign(new Error('専門技術者レビューが必要な成果物は Reviewer または Administrator だけがレビューできます'), { status: 403 });
        if (expertConfirmed !== true) throw Object.assign(new Error('専門技術者レビューが必要な成果物です。expert_confirmed: true（専門技術者として内容を確認した）を付けてください'), { status: 422 });
        // T5 / T6: AI 単独では完了できないため、確認した専門技術者の所見（expert_note）を必ず残す
        if (cur[0].ai_completion_prohibited && !(typeof expertNote === 'string' && expertNote.trim().length >= 10)) throw Object.assign(new Error('T5/T6 の成果物は AI 単独では完了できません。専門技術者の所見（expert_note、10 文字以上）が必須です'), { status: 422 });
      }
      const pinned = contentHash(cur[0].content);
      const { rows } = await client.query(
        `UPDATE artifacts SET review_state = 'reviewed', reviewed_by = $1, reviewed_at = now(), review_note = $2,
                              content_hash = COALESCE(content_hash, $4), reviewed_content_hash = $4, updated_at = now()
         WHERE id = $3 AND review_state = 'draft' RETURNING id, review_state, reviewed_content_hash`,
        [req.user.id, [note, expertNote ? `専門技術者所見: ${expertNote}` : ''].filter(Boolean).join('\n') || null, id, pinned],
      );
      if (rows.length === 0) throw Object.assign(new Error('artifact が見つからないか、既にレビュー済みです'), { status: 409 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'artifact.review', resourceType: 'artifact', resourceId: id,
        detail: { note, reviewed_content_hash: pinned, expert_review_required: !!cur[0].expert_review_required, expert_confirmed: expertConfirmed === true, ai_completion_prohibited: !!cur[0].ai_completion_prohibited, expert_note: expertNote || null },
      });
      return rows[0];
    });
    res.json({ artifact: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
