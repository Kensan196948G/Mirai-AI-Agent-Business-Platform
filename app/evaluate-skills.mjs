#!/usr/bin/env node
/**
 * Skill 評価ランナー CLI（C-16）。各 Skill の evals/cases.jsonl を実行し、合否を表示・保存する。
 *
 * 使い方:
 *   node evaluate-skills.mjs [--skill <id>[,<id>]] [--live] [--no-record] [--email <実行者>] [--compare]
 *   --live      実 LLM（DeepSeek）を呼ぶ（費用が発生。Skill 改訂前後の品質比較に使う）。既定は offline（LLM スタブ・費用ゼロ）
 *   --no-record 結果を DB（skill_evaluations）へ保存しない
 *   --compare   保存済みの直近 2 バッチを比較し、回帰（前回合格 → 今回不合格）を表示する
 * 検索・引用検証 Tool は接続先 DB の承認済み出典を読むだけで、Run / 成果物 / イベントは作らない。
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool } from './src/lib/db.js';
import { evaluatePack, evaluationSummary, listSkillIds } from './src/agent-runtime/evaluation-runner.js';

loadEnv(new URL('.env', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const PACK = opt('--pack') || 'mirai-construction';
const mode = args.includes('--live') ? 'live' : 'offline';
const record = !args.includes('--no-record');
const skillIds = opt('--skill') ? opt('--skill').split(',') : null;

const pool = getPool();
let evaluatedBy = null;
if (opt('--email')) {
  const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1 AND active`, [opt('--email')]);
  if (rows.length === 0) { console.error(`有効なユーザーが見つかりません: ${opt('--email')}`); process.exit(1); }
  evaluatedBy = rows[0].id;
}
if (mode === 'live' && !(process.env.LLM_PROVIDER && process.env.LLM_API_KEY)) { console.error('--live には LLM_PROVIDER / LLM_API_KEY が必要です'); process.exit(1); }

try {
  if (args.includes('--compare')) {
    for (const skillId of skillIds || listSkillIds(PACK)) {
      const s = await evaluationSummary(pool, { skillId });
      if (!s.latest) { console.log(`${skillId}: 評価結果なし`); continue; }
      const l = s.latest;
      const reg = s.regression ? (s.regression.newly_failed.length ? ` 回帰: ${s.regression.newly_failed.join(',')}` : ' 回帰なし') + (s.regression.fixed.length ? ` 改善: ${s.regression.fixed.join(',')}` : '') + (s.regression.content_changed ? '（内容変更あり）' : '（内容同一）') : ' （比較対象なし）';
      console.log(`${skillId}@${l.version} [${l.mode}] ${l.passed}/${l.total} ${l.content_hash.slice(0, 12)} ${new Date(l.created_at).toISOString().slice(0, 16)}${reg}`);
    }
  } else {
    console.log(`評価: pack=${PACK} mode=${mode}${record ? '' : '（保存しない）'}`);
    const { batchId, skills } = await evaluatePack(pool, { packId: PACK, mode, skillIds, record, evaluatedBy });
    let total = 0, passed = 0, cost = 0;
    for (const s of skills) {
      total += s.total; passed += s.passed;
      const mark = s.total === 0 ? '—' : (s.passed === s.total ? 'PASS' : 'FAIL');
      console.log(`${mark.padEnd(4)} ${s.skill_id}@${s.version} ${s.passed}/${s.total}`);
      for (const r of s.results) {
        cost += r.cost_usd;
        if (!r.passed) console.log(`     ✗ ${r.case_id}: ${r.error || r.checks.filter((c) => !c.ok).map((c) => `${c.key} 期待 ${JSON.stringify(c.expected)} 実際 ${JSON.stringify(c.actual)}`).join('; ')}`);
      }
    }
    console.log(`合計 ${passed}/${total}${cost ? ` 費用 $${cost.toFixed(4)}` : ''}${record ? ` batch=${batchId}` : ''}`);
    if (passed < total) process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message); process.exitCode = 1;
} finally {
  await closePool();
}
