#!/usr/bin/env node
/**
 * 出典（source_records）のレビュー・版管理 CLI（B-10/B-11）。API（/api/sources）と同じ処理を呼ぶ。
 *
 * 使い方:
 *   node manage-sources.mjs <レビュー担当のemail> list [pending|approved|superseded|quarantined] [technology_catalog|project_case]
 *   node manage-sources.mjs <email> approve <id|id,id,...|--all-pending> [--allow-self-review] [--note "..."]
 *   node manage-sources.mjs <email> quarantine <id> --reason "..."
 *   node manage-sources.mjs <email> retire <id> --effective-to YYYY-MM-DD [--reason "..."]
 *
 * 職務分離: 取り込み者本人の承認は拒否される。Approver が 1 人しかいない期間は --allow-self-review を
 * 明示すると承認でき、監査ログに selfReviewException=true が残る。
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { listSources, approveSource, quarantineSource, retireSource, REVIEW_ROLES } from './src/lib/source-ops.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const [email, command, target, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
if (!email || !command) {
  console.error('使い方: node manage-sources.mjs <email> list|approve|quarantine|retire ...');
  process.exit(1);
}

const pool = getPool();
const { rows: users } = await pool.query(`SELECT id, name, role, active FROM users WHERE email = $1`, [email]);
if (users.length === 0 || !users[0].active) { console.error(`有効なユーザーが見つかりません: ${email}`); process.exit(1); }
const reviewer = users[0];

try {
  if (command === 'list') {
    const rows = await listSources(pool, { status: target || null, sourceType: rest[0] || null, limit: 500 });
    for (const r of rows) {
      console.log(`${String(r.id).padStart(4)} ${r.source_code} v${r.version} [${r.status}] ${r.source_type} ${r.category || '-'} | ${r.title} (${r.content_length} 文字)${r.effective_to ? ` 有効期限 ${new Date(r.effective_to).toISOString().slice(0, 10)}` : ''}${r.review_note ? ` | ${r.review_note}` : ''}`);
    }
    console.log(`${rows.length} 件`);
  } else {
    if (!REVIEW_ROLES.includes(reviewer.role)) { console.error(`${command} は ${REVIEW_ROLES.join(' / ')} が行う（role=${reviewer.role}）`); process.exit(1); }
    if (command === 'approve') {
      let ids;
      if (target === '--all-pending') ids = (await listSources(pool, { status: 'pending', limit: 1000 })).map((r) => Number(r.id));
      else ids = String(target || '').split(',').map((s) => Number(s)).filter(Number.isInteger);
      if (ids.length === 0) { console.error('承認対象がありません'); process.exit(1); }
      const allowSelfReview = rest.includes('--allow-self-review');
      let ok = 0;
      for (const id of ids.sort((a, b) => a - b)) {
        try {
          const r = await withTransaction((client) => approveSource(client, { id, reviewer, allowSelfReview, note: opt('--note') }));
          ok++;
          console.log(`approved: id=${id}${r.supersededId ? ` (旧版 id=${r.supersededId} を superseded)` : ''}${r.selfReviewException ? ' [self-review 例外]' : ''}`);
        } catch (e) { console.error(`skip: id=${id} ${e.message}`); }
      }
      console.log(`承認 ${ok}/${ids.length} 件`);
    } else if (command === 'quarantine') {
      const r = await withTransaction((client) => quarantineSource(client, { id: Number(target), reviewer, reason: opt('--reason') }));
      console.log(`quarantined: id=${r.id}`);
    } else if (command === 'retire') {
      const effectiveTo = opt('--effective-to');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo || '')) { console.error('--effective-to YYYY-MM-DD が必要'); process.exit(1); }
      const r = await withTransaction((client) => retireSource(client, { id: Number(target), reviewer, effectiveTo, reason: opt('--reason') }));
      console.log(`retired: id=${r.id} effective_to=${effectiveTo}`);
    } else {
      console.error(`不明なコマンド: ${command}`); process.exit(1);
    }
  }
} catch (err) {
  console.error(err.message); process.exitCode = 1;
} finally {
  await closePool();
}
