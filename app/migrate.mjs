#!/usr/bin/env node
// マイグレーションランナー（外部ツール不使用・冪等）。
// migrations/*.sql をファイル名昇順で適用し、適用済みは schema_migrations で記録する。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool } from './src/lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
loadEnv(join(__dirname, '.env'));

async function main() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`適用: ${file}`);
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`マイグレーション失敗: ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? '適用対象なし（最新）' : `${count} 件適用完了`);
  await closePool();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
