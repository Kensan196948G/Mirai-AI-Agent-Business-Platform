import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12時間

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEY_LEN);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(plain, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * userId・token_version・有効期限を含む署名付きセッショントークンを発行する。
 * サーバ側セッションストアは持たないが、users.token_version と突き合わせることで
 * ログアウト（version インクリメント）による即時失効を実現する。
 */
export function createSessionToken(userId, tokenVersion, secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${tokenVersion}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** 署名・有効期限のみを検証する（token_version が現在値と一致するかは呼び出し側が DB と照合する）。 */
export function verifySessionToken(token, secret) {
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 4) return null;
  const [userIdStr, versionStr, expStr, sig] = segments;
  const payload = `${userIdStr}.${versionStr}.${expStr}`;
  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const userId = Number(userIdStr);
  const tokenVersion = Number(versionStr);
  if (!Number.isFinite(userId) || !Number.isFinite(tokenVersion)) return null;
  return { userId, tokenVersion };
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure }) {
  const attrs = [
    `session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export const CLEAR_SESSION_COOKIE = 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';

/** 初期管理者アカウント用のランダムパスワードを生成する（保存も表示も呼び出し側の責任）。 */
export function generateInitialPassword() {
  return randomBytes(18).toString('base64url');
}
