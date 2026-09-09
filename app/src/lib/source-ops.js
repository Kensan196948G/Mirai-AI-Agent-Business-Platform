/**
 * 出典（source_records）の取り込み・レビュー・版管理の共通処理（B-8〜B-11）。
 * API（routes/sources.js）と CLI（ingest-sources.mjs / manage-sources.mjs）が共用する。
 *
 * ライフサイクル: pending（取り込み直後、検索対象外）→ approved（Approver/Administrator が承認）
 *               → superseded（同じ URL の新版が承認された）/ quarantined（除外対象を検出・人が隔離）
 * 同じ URL を再取り込みして内容（content_hash）が変わっていれば version+1 の pending 行を作り、
 * 承認時に旧版を superseded にして effective_to を当日にする。
 */
import { createHash } from 'node:crypto';
import { recordAudit } from './audit.js';

export const SOURCE_STATUSES = ['pending', 'approved', 'superseded', 'quarantined'];
export const REVIEW_ROLES = ['Administrator', 'Approver'];

export function contentHash(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export async function nextSourceCode(client) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(substring(source_code FROM 'SRC-(\\d+)')::int), 0) AS n FROM source_records`);
  return `SRC-${String(rows[0].n + 1).padStart(4, '0')}`;
}

/**
 * 取り込み結果を pending として保存する。戻り値 { action: 'inserted'|'unchanged'|'new_version', record }
 * ingestedBy は { id, name }（運用者）。
 * - 同じ canonical_url の最新版と content_hash が同じなら何もしない（unchanged）
 * - 異なれば version+1、supersedes_id=最新版 で pending 行を追加（new_version）
 * quarantined=true の場合は status='quarantined' で保存し、承認できない（人が内容を確認してから再取り込み）。
 */
export async function saveIngestedSource(client, {
  canonicalUrl, title, sourceType, evidenceType, category, summary, contentText, attributes,
  quarantined, quarantineReasons, fetchedAt, ingestedBy, licenseOrPermission,
}) {
  const hash = contentHash(contentText);
  const { rows: latest } = await client.query(
    `SELECT id, version, content_hash, status FROM source_records WHERE canonical_url = $1 ORDER BY version DESC LIMIT 1`,
    [canonicalUrl],
  );
  const prev = latest[0];
  if (prev && prev.content_hash === hash) return { action: 'unchanged', record: prev };

  const version = prev ? Number(prev.version) + 1 : 1;
  const status = quarantined ? 'quarantined' : 'pending';
  const sourceCode = await nextSourceCode(client);
  const { rows } = await client.query(
    `INSERT INTO source_records
       (source_code, canonical_url, title, source_type, evidence_type, category, summary, content_text, attributes,
        fetched_at, content_hash, version, classification, license_or_permission, supersedes_id, status, ingested_by, review_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'public',$13,$14,$15,$16,$17)
     RETURNING *`,
    [sourceCode, canonicalUrl, title, sourceType, evidenceType, category, summary, contentText, JSON.stringify(attributes || {}),
      fetchedAt || new Date(), hash, version, licenseOrPermission || null, prev ? prev.id : null, status, ingestedBy ? ingestedBy.id : null,
      quarantined ? `隔離: ${(quarantineReasons || []).join(' / ')}` : null],
  );
  await recordAudit(client, {
    actorId: ingestedBy ? ingestedBy.id : null, actorType: ingestedBy ? 'user' : 'service', actorName: ingestedBy ? ingestedBy.name : 'ingest-sources',
    action: 'source.ingest', resourceType: 'source_record', resourceId: rows[0].id,
    detail: { sourceCode, canonicalUrl, version, status, supersedesId: prev ? Number(prev.id) : null },
  });
  return { action: prev ? 'new_version' : 'inserted', record: rows[0] };
}

/**
 * 承認。取り込み者と承認者が同一の場合は職務分離（SoD）違反として拒否する。
 * 実運用の Approver が 1 人しかいない期間だけ allowSelfReview=true で例外を認め、監査ログに明記する。
 */
export async function approveSource(client, { id, reviewer, allowSelfReview = false, note }) {
  const { rows } = await client.query(`SELECT * FROM source_records WHERE id = $1 FOR UPDATE`, [id]);
  const rec = rows[0];
  if (!rec) throw Object.assign(new Error('source_record が見つかりません'), { status: 404 });
  if (rec.status !== 'pending') throw Object.assign(new Error(`pending ではありません（status=${rec.status}）`), { status: 409 });
  const selfReview = rec.ingested_by !== null && Number(rec.ingested_by) === Number(reviewer.id);
  if (selfReview && !allowSelfReview) {
    throw Object.assign(new Error('取り込み者本人は承認できません（職務分離）。別の Approver が承認するか、例外として allowSelfReview を明示してください'), { status: 403 });
  }
  await client.query(
    `UPDATE source_records SET status = 'approved', reviewer_id = $1, reviewed_at = now(), effective_from = COALESCE(effective_from, CURRENT_DATE),
       review_note = COALESCE($2, review_note) WHERE id = $3`,
    [reviewer.id, note || null, id],
  );
  let supersededId = null;
  if (rec.supersedes_id) {
    const { rows: old } = await client.query(
      `UPDATE source_records SET status = 'superseded', effective_to = LEAST(COALESCE(effective_to, CURRENT_DATE), CURRENT_DATE)
       WHERE id = $1 AND status = 'approved' RETURNING id`,
      [rec.supersedes_id],
    );
    supersededId = old[0] ? Number(old[0].id) : null;
  }
  await recordAudit(client, {
    actorId: reviewer.id, actorType: 'user', actorName: reviewer.name,
    action: 'source.approve', resourceType: 'source_record', resourceId: id,
    detail: { sourceCode: rec.source_code, version: rec.version, supersededId, selfReviewException: selfReview },
  });
  return { id: Number(id), supersededId, selfReviewException: selfReview };
}

export async function quarantineSource(client, { id, reviewer, reason }) {
  const { rows } = await client.query(
    `UPDATE source_records SET status = 'quarantined', reviewer_id = $1, reviewed_at = now(), review_note = $2, effective_to = CURRENT_DATE
     WHERE id = $3 AND status IN ('pending', 'approved') RETURNING source_code`,
    [reviewer.id, `隔離: ${reason || '理由未記入'}`, id],
  );
  if (rows.length === 0) throw Object.assign(new Error('source_record が見つからないか、隔離できる状態ではありません'), { status: 409 });
  await recordAudit(client, {
    actorId: reviewer.id, actorType: 'user', actorName: reviewer.name,
    action: 'source.quarantine', resourceType: 'source_record', resourceId: id, detail: { sourceCode: rows[0].source_code, reason },
  });
  return { id: Number(id) };
}

/** 旧版の失効（effective_to を設定）。承認済みのまま日付だけを閉じる（検索対象から外れる）。 */
export async function retireSource(client, { id, reviewer, effectiveTo, reason }) {
  const { rows } = await client.query(
    `UPDATE source_records SET effective_to = $1::date, review_note = COALESCE($2, review_note) WHERE id = $3 AND status = 'approved' RETURNING source_code`,
    [effectiveTo, reason ? `失効: ${reason}` : null, id],
  );
  if (rows.length === 0) throw Object.assign(new Error('承認済みの source_record が見つかりません'), { status: 409 });
  await recordAudit(client, {
    actorId: reviewer.id, actorType: 'user', actorName: reviewer.name,
    action: 'source.retire', resourceType: 'source_record', resourceId: id, detail: { sourceCode: rows[0].source_code, effectiveTo, reason },
  });
  return { id: Number(id) };
}

export async function listSources(client, { status, sourceType, limit = 200, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT s.id, s.source_code, s.canonical_url, s.title, s.source_type, s.evidence_type, s.category, s.summary, s.attributes,
            s.version, s.status, s.effective_from, s.effective_to, s.fetched_at, s.reviewed_at, s.review_note, s.supersedes_id,
            length(s.content_text) AS content_length,
            u.name AS ingested_by_name, r.name AS reviewer_name
     FROM source_records s LEFT JOIN users u ON u.id = s.ingested_by LEFT JOIN users r ON r.id = s.reviewer_id
     WHERE ($1::text IS NULL OR s.status = $1) AND ($2::text IS NULL OR s.source_type = $2)
     ORDER BY s.id DESC LIMIT $3 OFFSET $4`,
    [status || null, sourceType || null, limit, offset],
  );
  return rows;
}
