#!/usr/bin/env node
/**
 * 監査ログの日次アンカー（F-30）。systemd timer から毎日実行する。
 *   1. 直前アンカー以降のチェーンを検証（hash_version 1/2 混在に対応）
 *   2. 末尾を audit_anchors に固定
 *   3. 同じ内容を DB 外の追記専用ファイル（AUDIT_ANCHOR_DIR、既定 /home/kensan/backups/mira-agent-os）へ 1 行追記
 *      → DB を丸ごと書き換える改ざんがあっても、ファイル側の行と突き合わせて検出できる
 * 使い方: node audit-anchor.mjs [envファイル]（既定 .env。MVP は .env.mvp）
 * チェーンが壊れていれば終了コード 1（アンカー自体は chain_ok=false で記録し、隠さない）。
 */
import { appendFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { recordAnchor } from './src/lib/audit.js';

const envFile = process.argv[2] || '.env';
loadEnv(new URL(envFile, import.meta.url).pathname);
const dir = process.env.AUDIT_ANCHOR_DIR || '/home/kensan/backups/mira-agent-os';
const dbName = (() => { try { return new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''); } catch { return 'unknown'; } })();
const file = join(dir, `audit-anchors-${dbName}.log`);

try {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { anchor, verified } = await withTransaction((client) => recordAnchor(client, { externalRef: file }));
  const line = JSON.stringify({
    at: anchor.created_at, host: hostname(), db: dbName, anchor_id: Number(anchor.id), last_audit_id: Number(anchor.last_audit_id),
    entry_count: Number(anchor.entry_count), last_hash: anchor.last_hash, anchor_hash: anchor.anchor_hash, prev_anchor_hash: anchor.prev_anchor_hash, chain_ok: anchor.chain_ok,
  });
  appendFileSync(file, line + '\n', { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* 既存ファイルの権限維持 */ }
  console.log(`[audit-anchor] ${dbName} anchor#${anchor.id} last_id=${anchor.last_audit_id} entries=${anchor.entry_count} checked=${verified.checked} chain_ok=${anchor.chain_ok} → ${file}`);
  if (!verified.ok) {
    console.error(`[audit-anchor] WARNING チェーン不整合 ${verified.breaks.length} 件: ${JSON.stringify(verified.breaks.slice(0, 5))}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`[audit-anchor] ERROR ${err.message}`);
  process.exitCode = 2;
} finally {
  await closePool();
}
