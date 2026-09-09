/**
 * CSRF 対策（F-31）: Cookie 認証の更新系 API（POST / PATCH / PUT / DELETE）に対して Origin を検証する。
 * - ブラウザはクロスサイトの更新系リクエストに必ず Origin（または Sec-Fetch-Site）を付けるため、
 *   Origin のホストが自ホスト（または APP_ALLOWED_ORIGINS）と一致しない場合は 403
 * - Origin も Sec-Fetch-Site も無いリクエスト（curl / テスト / CLI）は Cookie を自動送信しないため対象外
 * - セッション Cookie は SameSite=Lax（既存）で、二重の防御になる
 */
const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
}

export function allowedOrigins() {
  return String(process.env.APP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => hostOf(s) || s.toLowerCase());
}

export function csrfGuard(req, res, next) {
  if (!UNSAFE.has(req.method)) return next();
  const fetchSite = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(String(fetchSite))) {
    return res.status(403).json({ error: 'クロスサイトからの更新要求は拒否します（CSRF 対策）' });
  }
  if (origin) {
    const host = hostOf(origin);
    const self = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    if (host !== self && !allowedOrigins().includes(host)) {
      return res.status(403).json({ error: 'Origin が一致しないため更新要求を拒否します（CSRF 対策）' });
    }
  }
  return next();
}
