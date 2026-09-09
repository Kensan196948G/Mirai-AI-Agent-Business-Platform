/**
 * レート制限（F-32）。単一プロセス・メモリ内の固定ウィンドウ方式。
 * 本アプリは API が 1 プロセス（systemd）で動くため十分。複数プロセス化する場合は DB / Redis へ移す。
 * 上限は環境変数で調整でき、呼び出し時に読む（テストで切り替えられる）。
 */
const buckets = new Map();

function windowKey(key, windowMs) {
  return `${key}:${Math.floor(Date.now() / windowMs)}`;
}

/** key ごとに windowMs 内の回数を数え、limit を超えたら false。 */
export function consume(key, { limit, windowMs }) {
  const k = windowKey(key, windowMs);
  const n = (buckets.get(k) || 0) + 1;
  buckets.set(k, n);
  if (buckets.size > 5000) sweep(windowMs);
  return n <= limit;
}

export function remaining(key, { limit, windowMs }) {
  return Math.max(0, limit - (buckets.get(windowKey(key, windowMs)) || 0));
}

export function resetAll() {
  buckets.clear();
}

function sweep(windowMs) {
  const current = Math.floor(Date.now() / windowMs);
  for (const k of buckets.keys()) {
    const w = Number(k.slice(k.lastIndexOf(':') + 1));
    if (Number.isFinite(w) && w < current - 1) buckets.delete(k);
  }
}

export function loginLimits() {
  return {
    perIp: { limit: Number(process.env.LOGIN_RATE_LIMIT_PER_IP || '30'), windowMs: 10 * 60 * 1000 },
    perEmailFailures: { limit: Number(process.env.LOGIN_FAILURE_LIMIT_PER_EMAIL || '5'), windowMs: 15 * 60 * 1000 },
  };
}

export function clientIp(req) {
  const xff = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}

/** Express ミドルウェア: IP 単位の回数制限。 */
export function rateLimitByIp(name, { limit, windowMs }) {
  return (req, res, next) => {
    if (!consume(`${name}:${clientIp(req)}`, { limit, windowMs })) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: '要求が多すぎます。しばらく待ってから再度お試しください' });
    }
    next();
  };
}
