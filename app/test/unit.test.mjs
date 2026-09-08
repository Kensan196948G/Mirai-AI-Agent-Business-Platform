import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  generateInitialPassword,
} from '../src/lib/auth.js';

test('hashPassword / verifyPassword: 正しいパスワードのみ true', async () => {
  const hash = await hashPassword('correct-horse-battery-staple');
  assert.equal(await verifyPassword('correct-horse-battery-staple', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('hashPassword: 同じ平文でも salt が異なるため hash は毎回変わる', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
});

test('verifyPassword: 不正な形式の stored 値は false（例外を投げない）', async () => {
  assert.equal(await verifyPassword('x', 'not-a-valid-hash'), false);
  assert.equal(await verifyPassword('x', 'scrypt:onlytwoparts'), false);
});

test('createSessionToken / verifySessionToken: 正しい secret でのみ復号でき、userId と tokenVersion を返す', () => {
  const token = createSessionToken(42, 3, 'secret-a');
  assert.deepEqual(verifySessionToken(token, 'secret-a'), { userId: 42, tokenVersion: 3 });
  assert.equal(verifySessionToken(token, 'secret-b'), null);
});

test('verifySessionToken: 改ざんされたトークンは拒否する', () => {
  const token = createSessionToken(1, 0, 'secret');
  const [userId, version, exp, sig] = token.split('.');
  const tampered = `${Number(userId) + 1}.${version}.${exp}.${sig}`;
  assert.equal(verifySessionToken(tampered, 'secret'), null);
});

test('verifySessionToken: token_version を書き換えても署名検証で拒否される', () => {
  const token = createSessionToken(1, 0, 'secret');
  const [userId, version, exp, sig] = token.split('.');
  const tampered = `${userId}.${Number(version) + 1}.${exp}.${sig}`;
  assert.equal(verifySessionToken(tampered, 'secret'), null);
});

test('verifySessionToken: 期限切れトークンは拒否する', () => {
  // exp を過去にした自作トークン（auth.js の sign 実装と同一の HMAC 構成で組み立てる）
  const past = Math.floor(Date.now() / 1000) - 10;
  const payload = `1.0.${past}`;
  const sig = createHmac('sha256', 'secret').update(payload).digest('base64url');
  assert.equal(verifySessionToken(`${payload}.${sig}`, 'secret'), null);
});

test('parseCookies: 複数 Cookie を分解できる', () => {
  const cookies = parseCookies('a=1; b=hello%20world');
  assert.deepEqual(cookies, { a: '1', b: 'hello world' });
});

test('parseCookies: undefined ヘッダーは空オブジェクト', () => {
  assert.deepEqual(parseCookies(undefined), {});
});

test('generateInitialPassword: 十分な長さでランダム', () => {
  const a = generateInitialPassword();
  const b = generateInitialPassword();
  assert.ok(a.length >= 20);
  assert.notEqual(a, b);
});
