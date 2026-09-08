import { getPool } from '../lib/db.js';
import { verifySessionToken, parseCookies } from '../lib/auth.js';
import { SESSION_SECRET } from '../lib/config.js';

export async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const claims = verifySessionToken(cookies.session, SESSION_SECRET);
  if (!claims) return res.status(401).json({ error: 'ログインが必要です' });
  const { rows } = await getPool().query(
    'SELECT id, email, name, role, dept, token_version, active FROM users WHERE id = $1',
    [claims.userId],
  );
  // token_version が現在値と一致しない、または無効化済みのユーザーは拒否する
  if (rows.length === 0 || rows[0].token_version !== claims.tokenVersion || !rows[0].active) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  req.user = rows[0];
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `権限不足（必要なロール: ${roles.join(' / ')}）` });
    }
    next();
  };
}
