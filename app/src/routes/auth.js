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
import { consume, remaining, loginLimits, rateLimitByIp } from '../lib/rate-limit.js';

const router = express.Router();

// F-32: IP 単位の回数制限（既定 30 回 / 10 分）と、メールアドレス単位の失敗回数制限（既定 5 回 / 15 分）
router.post('/login', (req, res, next) => rateLimitByIp('login', loginLimits().perIp)(req, res, next), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email, password は必須' });
  const failKey = `login-fail:${String(email).toLowerCase()}`;
  const { perEmailFailures } = loginLimits();
  if (remaining(failKey, perEmailFailures) === 0) {
    // 失敗回数が上限に達している間は、正しいパスワードでも受け付けない（総当たり対策）。カウントは時間で解除される
    return res.status(429).json({ error: 'ログイン失敗が続いたため一時的にロックしています。しばらく待ってから再度お試しください' });
  }

  const { rows } = await getPool().query(
    'SELECT id, password_hash, token_version, active FROM users WHERE email = $1',
    [email],
  );
  // 存在有無・無効化状態で応答を変えない（ユーザー列挙・タイミング対策のため常に verifyPassword を実行する）
  const passwordOk = rows.length > 0 && (await verifyPassword(password, rows[0].password_hash));
  const ok = passwordOk && rows[0].active;
  if (!ok) {
    consume(failKey, perEmailFailures); // 失敗だけを数える
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
  }

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
