#!/usr/bin/env node
/**
 * domain-packs/mirai-construction の Agent／Skill定義をDBへ同期する。
 *
 * 既定では draft（未承認）として登録し、Administrator が WebUI「業務Agent」画面または
 * POST /api/agent-catalog/versions/:kind/:id/approve で承認する（同期者と承認者を分離できる）。
 * --approve を付けた場合のみ同期と同時に承認する（運用者＝承認者の暫定運用。approved_by に記録）。
 * 内容ハッシュが変わった既存版は承認済みであっても draft へ戻る（承認後の改変を黙って通さない）。
 *
 * 使い方: node sync-agent-registry.mjs <実行者のemail> [--approve]
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { syncAgent } from './src/agent-runtime/registry.js';
import { loadUnifiedCatalog } from './src/agent-runtime/catalog.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const PACK_ID = 'mirai-construction';
// org-map.yaml に登録された実定義（agents/*.yaml）を持つ Agent をすべて同期する
const AGENTS = loadUnifiedCatalog(PACK_ID).agents.filter((a) => a.executable).map((a) => ({ agentId: a.agent_id, version: '1.0.0' }));

async function main() {
  const args = process.argv.slice(2);
  const approve = args.includes('--approve');
  const email = args.find((a) => !a.startsWith('--'));
  if (!email) {
    console.error('使い方: node sync-agent-registry.mjs <実行者のemail> [--approve]');
    process.exit(1);
  }
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name, role FROM users WHERE email = $1`, [email]);
  if (rows.length === 0) {
    console.error(`ユーザーが見つかりません: ${email}`);
    process.exit(1);
  }
  if (rows[0].role !== 'Administrator') {
    console.error(`Administrator ロールのユーザーのみ同期できます（現在: ${rows[0].role}）`);
    process.exit(1);
  }
  const approvedByUserId = rows[0].id;
  const status = approve ? 'approved' : 'draft';

  for (const { agentId, version } of AGENTS) {
    await withTransaction(async (client) => {
      const result = await syncAgent(client, PACK_ID, agentId, version, { approvedByUserId, status });
      const skillSummary = result.skillVersions.map((s) => `${s.skill_id}:${s.status}`).join(', ');
      console.log(`同期: ${agentId}@${version} [${result.agentVersion.status}]（skills: ${skillSummary}）`);
    });
  }

  if (approve) {
    console.log(`完了: ${rows[0].name}（${email}）の承認として ${AGENTS.length} 件のAgentを同期・承認しました`);
  } else {
    console.log(`完了: ${AGENTS.length} 件のAgentを draft として同期しました。WebUI「業務Agent」画面または`);
    console.log(`      POST /api/agent-catalog/versions/:kind/:id/approve で Administrator が承認してください。`);
  }
  await closePool();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
