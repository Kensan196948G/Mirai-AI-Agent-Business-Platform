import express from 'express';
import { getPool } from '../lib/db.js';
import {
  verifyPassword,
  createSessionToken,
  sessionCookie,
  CLEAR_SESSION_COOKIE,
} from '../lib/auth.js';
import { SESSION_SECRET, IS_PROD } from '../lib/config.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email, password は必須' });

  const { rows } = await getPool().query(
    'SELECT id, password_hash, token_version, active FROM users WHERE email = $1',
    [email],
  );
  // 存在有無・無効化状態で応答を変えない（ユーザー列挙・タイミング対策のため常に verifyPassword を実行する）
  const passwordOk = rows.length > 0 && (await verifyPassword(password, rows[0].password_hash));
  const ok = passwordOk && rows[0].active;
  if (!ok) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

  await getPool().query('UPDATE users SET last_login_at = now() WHERE id = $1', [rows[0].id]);

  const token = createSessionToken(rows[0].id, rows[0].token_version, SESSION_SECRET);
  res.setHeader('Set-Cookie', sessionCookie(token, { secure: IS_PROD }));
  res.json({ status: 'ok' });
});

// ステートレストークンは Cookie を消すだけでは失効しないため、token_version をインクリメントして
// 発行済みトークンを全て無効化する（他デバイスのセッションも含めて即時ログアウトになる）。
router.post('/logout', requireAuth, async (req, res) => {
  await getPool().query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
  res.setHeader('Set-Cookie', CLEAR_SESSION_COOKIE);
  res.json({ status: 'ok' });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
