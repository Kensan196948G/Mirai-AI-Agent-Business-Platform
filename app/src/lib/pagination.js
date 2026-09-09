/**
 * 一覧 API の pagination（S-015）。limit / offset を検証し、上限（既定 200）で頭打ちにする。
 * 既定の limit は各 API が従来返していた件数に合わせる（WebUI の既存呼び出しの挙動を変えない）。
 */
export const MAX_LIMIT = 200;

export function parsePage(query, { defaultLimit = 50, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = query?.limit === undefined ? defaultLimit : Number(query.limit);
  const rawOffset = query?.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw Object.assign(new Error('limit は 1 以上の整数です'), { status: 400 });
  if (!Number.isInteger(rawOffset) || rawOffset < 0) throw Object.assign(new Error('offset は 0 以上の整数です'), { status: 400 });
  return { limit: Math.min(rawLimit, maxLimit), offset: rawOffset };
}

/** レスポンスに添える page 情報。 */
export function pageInfo({ limit, offset }, total) {
  return { limit, offset, total: Number(total), has_more: offset + limit < Number(total) };
}
