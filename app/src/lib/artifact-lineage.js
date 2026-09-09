/**
 * 成果物（artifacts）の差分・履歴・版固定（C-15）。
 * - content_hash: キー順を正規化した content の SHA-256。レビュー時に reviewed_content_hash へ固定し、以後の改変を検出する
 * - 系譜（lineage）: 同じ Agent・種別（kind）・入力（input_hash）の成果物を直前 → 次 と結ぶ。再実行時の差分表示に使う
 * - diff: findings / unknowns / assumptions は文字列集合、sources は source_record_id 集合として追加・削除を出す
 */
import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

export function contentHash(content) {
  return createHash('sha256').update(JSON.stringify(canonical(content ?? {}))).digest('hex');
}

export function inputHash(input) {
  return createHash('sha256').update(JSON.stringify(canonical(input ?? {}))).digest('hex');
}

const LIST_FIELDS = ['findings', 'unknowns', 'assumptions', 'flags'];

function setDiff(prevList, nextList) {
  const prev = new Set(prevList), next = new Set(nextList);
  return { added: [...next].filter((x) => !prev.has(x)), removed: [...prev].filter((x) => !next.has(x)), unchanged: [...next].filter((x) => prev.has(x)).length };
}

export function diffArtifacts(prevContent, nextContent) {
  const p = prevContent || {}, n = nextContent || {};
  const out = {};
  for (const f of LIST_FIELDS) out[f] = setDiff(Array.isArray(p[f]) ? p[f].map(String) : [], Array.isArray(n[f]) ? n[f].map(String) : []);
  const ids = (c) => (Array.isArray(c.sources) ? c.sources.map((s) => Number(s.source_record_id)).filter(Number.isFinite).map(String) : []);
  out.sources = setDiff(ids(p), ids(n));
  out.requires_human_review = { before: p.requires_human_review ?? null, after: n.requires_human_review ?? null };
  out.changed = LIST_FIELDS.concat('sources').some((f) => out[f].added.length > 0 || out[f].removed.length > 0)
    || out.requires_human_review.before !== out.requires_human_review.after;
  out.summary = Object.fromEntries(LIST_FIELDS.concat('sources').map((f) => [f, `+${out[f].added.length} / -${out[f].removed.length}`]));
  return out;
}

/** 同じ Agent・種別・入力で、別の Run が作った直近の成果物（系譜の直前）。 */
export async function findPreviousArtifact(client, { agentId, kind, inputHash: ih, excludeRunId }) {
  const { rows } = await client.query(
    `SELECT a.id, a.artifact_code, a.lineage_version, a.run_id FROM artifacts a JOIN agent_runs r ON r.id = a.run_id
     WHERE r.agent_id = $1 AND a.kind = $2 AND a.input_hash = $3 AND a.run_id <> $4
     ORDER BY a.id DESC LIMIT 1`,
    [agentId, kind, ih, excludeRunId],
  );
  return rows[0] || null;
}

/** 系譜を最古 → 最新の順に返す（previous_artifact_id を辿る。上限 50）。 */
export async function lineageOf(client, artifactId) {
  const { rows } = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT a.*, 0 AS depth FROM artifacts a WHERE a.id = $1
       UNION ALL
       SELECT a.*, c.depth + 1 FROM artifacts a JOIN chain c ON a.id = c.previous_artifact_id WHERE c.depth < 50
     )
     SELECT c.id, c.artifact_code, c.lineage_version, c.review_state, c.content_hash, c.reviewed_content_hash, c.created_at, c.run_id, r.run_code
     FROM chain c JOIN agent_runs r ON r.id = c.run_id ORDER BY c.depth DESC`,
    [artifactId],
  );
  return rows;
}

/** レビュー済み成果物の内容がレビュー時から変わっていないか（版固定の検証）。 */
export function integrityOf(artifact) {
  if (artifact.review_state !== 'reviewed' || !artifact.reviewed_content_hash) return null;
  return contentHash(artifact.content) === artifact.reviewed_content_hash;
}
