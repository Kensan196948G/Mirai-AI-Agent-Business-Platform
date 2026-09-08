#!/usr/bin/env node
/**
 * domain-packs/mirai-construction の Agent／Skill定義をDBへ同期し、承認済み版として登録する。
 *
 * 「未承認、無効、失効、未評価の版を本番実行させない」ため、このスクリプトの実行自体を
 * 暫定的な承認行為として扱う（approved_by に実行者を記録する）。実行できるのは
 * リポジトリ・本番DBへの書き込み権限を持つ運用者のみを前提とする。
 * 将来的にはWebUI上の正式な承認フローに置き換える（Backlog）。
 *
 * 使い方: node sync-agent-registry.mjs <承認者のemail>
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { syncAgent } from './src/agent-runtime/registry.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const PACK_ID = 'mirai-construction';
const AGENTS = [
  { agentId: 'technology-selection', version: '1.0.0' },
  { agentId: 'project-case-research', version: '1.0.0' },
  { agentId: 'knowledge-quality', version: '1.0.0' },
];

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('使い方: node sync-agent-registry.mjs <承認者のemail>');
    process.exit(1);
  }
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name, role FROM users WHERE email = $1`, [email]);
  if (rows.length === 0) {
    console.error(`ユーザーが見つかりません: ${email}`);
    process.exit(1);
  }
  if (rows[0].role !== 'Administrator') {
    console.error(`Administrator ロールのユーザーのみ同期を承認できます（現在: ${rows[0].role}）`);
    process.exit(1);
  }
  const approvedByUserId = rows[0].id;

  for (const { agentId, version } of AGENTS) {
    await withTransaction(async (client) => {
      const result = await syncAgent(client, PACK_ID, agentId, version, { approvedByUserId });
      console.log(`同期: ${agentId}@${version}（skills: ${result.skillVersions.map((s) => s.skill_id).join(', ')}）`);
    });
  }

  console.log(`完了: ${rows[0].name}（${email}）の承認として ${AGENTS.length} 件のAgentを同期しました`);
  await closePool();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
