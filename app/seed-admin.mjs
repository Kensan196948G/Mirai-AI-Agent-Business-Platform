#!/usr/bin/env node
// 初期 Administrator アカウントを作成する。既に同じ email が存在する場合は何もしない（冪等）。
// 生成したパスワードは標準出力に一度だけ表示する。ログファイル・DBには平文を残さない。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool } from './src/lib/db.js';
import { hashPassword, generateInitialPassword } from './src/lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '.env'));

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const name = process.argv[3] || 'Administrator';

if (!email) {
  console.error('使い方: node seed-admin.mjs <email> [name]');
  process.exit(1);
}

async function main() {
  const pool = getPool();
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`既に存在するため作成をスキップ: ${email}`);
    await closePool();
    return;
  }

  const password = generateInitialPassword();
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'Administrator', $3)`,
    [email, name, hash],
  );

  console.log('Administrator アカウントを作成しました。');
  console.log(`  email    : ${email}`);
  console.log(`  password : ${password}`);
  console.log('この初期パスワードは今だけ表示されます。安全な場所に控え、ログイン後は各自の運用ルールに従ってください。');
  await closePool();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
