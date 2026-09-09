#!/usr/bin/env node
/**
 * Agent Runtime の稼働監視（A-5）。systemd timer から定期実行する。
 * Worker 停止・キュー滞留・Lease 期限切れを検知したら journal へ WARNING を出し、終了コード 1 で終える
 * （systemd の OnFailure= や `systemctl --failed` で検知できる）。正常時は終了コード 0。
 *
 * 使い方: node watchdog.mjs            （.env を読む。MVP は EnvironmentFile で .env.mvp を渡す）
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool } from './src/lib/db.js';
import { collectHealth, evaluateHealth } from './src/lib/health.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const label = process.env.WATCHDOG_LABEL || 'mira-agent-os';
try {
  const h = await collectHealth(getPool());
  const problems = evaluateHealth(h);
  const summary = `worker alive=${h.worker.alive}(${h.worker.alive_count}) queued=${h.queue.queued} oldest=${h.queue.oldest_queued_age_s}s running=${h.runs.running} lease_expired=${h.runs.lease_expired}`;
  if (problems.length === 0) {
    console.log(`[${label}] OK ${summary}`);
    await closePool();
    process.exit(0);
  }
  console.error(`[${label}] WARNING ${summary}`);
  for (const p of problems) console.error(`[${label}]  - ${p}`);
  await closePool();
  process.exit(1);
} catch (err) {
  console.error(`[${label}] ERROR 監視自体に失敗: ${err.message}`);
  process.exit(2);
}
