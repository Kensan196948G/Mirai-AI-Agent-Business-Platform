#!/usr/bin/env node
/**
 * 運用者用: Agent Run を作成する（A-3/A-4 の検証や、WebUI を使えない場面向け）。
 * API（POST /api/agent-runs）と同じ検証（Agent の許可入力キー、ロール、承認済み版）を通し、
 * 監査ログにも同じ action で記録する。Worker が起動していれば順次実行される。
 *
 * 使い方:
 *   node create-agent-run.mjs <実行者のemail> <agentId> '<入力JSON>' [--wait]
 *   例: node create-agent-run.mjs admin@example.com technology-selection '{"query":"MC-Wake の適用条件"}' --wait
 * --wait を付けると完了/失敗まで 3 秒間隔で最大 5 分ポーリングし、イベントと成果物を表示する。
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { createRunForUser, inputKeysFor } from './src/agent-runtime/run-create.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const [email, agentId, inputJson, ...flags] = process.argv.slice(2);
if (!email || !agentId || !inputJson) {
  console.error("使い方: node create-agent-run.mjs <email> <agentId> '<入力JSON>' [--wait]");
  process.exit(1);
}
if (!inputKeysFor(agentId)) { console.error(`不正な agentId: ${agentId}`); process.exit(1); }
let input;
try { input = JSON.parse(inputJson); } catch (e) { console.error(`入力JSONの解析に失敗: ${e.message}`); process.exit(1); }

const pool = getPool();
const { rows: users } = await pool.query(`SELECT id, name, role, active FROM users WHERE email = $1`, [email]);
if (users.length === 0 || !users[0].active) { console.error(`有効なユーザーが見つかりません: ${email}`); process.exit(1); }
const user = users[0];

// API（POST /api/agent-runs）と同じ検証（許可入力キー・ロール・並行実行上限・承認済み版）と監査を通る
let run;
try {
  run = await withTransaction((client) => createRunForUser(client, { user, agentId, input, via: 'cli' }));
} catch (e) { console.error(e.message); await closePool(); process.exit(1); }
console.log(`created: ${run.run_code} (id=${run.id}) agent=${agentId} status=${run.status}`);

if (flags.includes('--wait')) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cur = run;
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    cur = (await pool.query(`SELECT * FROM agent_runs WHERE id = $1`, [run.id])).rows[0];
    process.stdout.write(`  [${i * 3}s] ${cur.status} step=${cur.current_step}/${cur.max_steps}\n`);
    if (['completed', 'failed', 'cancelled'].includes(cur.status)) break;
  }
  console.log(`final: ${cur.status} ${cur.error_message || ''}`);
  const { rows: ev } = await pool.query(`SELECT seq, type, skill_id, tool_name, status, cost FROM run_events WHERE run_id = $1 ORDER BY seq`, [run.id]);
  for (const e of ev) console.log(`  #${e.seq} ${e.type} ${e.skill_id || ''} ${e.tool_name || ''} ${e.status || ''}${e.cost ? ` cost=$${Number(e.cost).toFixed(4)}` : ''}`);
  const { rows: arts } = await pool.query(`SELECT artifact_code, review_state, content FROM artifacts WHERE run_id = $1 ORDER BY id`, [run.id]);
  for (const a of arts) {
    const c = a.content;
    console.log(`artifact ${a.artifact_code} (${a.review_state}) findings=${(c.findings || []).length} unknowns=${(c.unknowns || []).length} sources=${(c.sources || []).length} requires_human_review=${c.requires_human_review}`);
    for (const f of c.findings || []) console.log(`   - ${f}`);
  }
}
await closePool();
