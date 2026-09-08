/**
 * Agent版・Skill版のRegistry。domain-packs/ のファイルをDBへ同期し、
 * 「承認済みの版だけを固定してRunする」ためのDBアクセスを提供する。
 *
 * 同期（sync）を実行できるのはリポジトリへの書き込み権限を持つ運用者のみであり、
 * 本セッションでは sync 実行自体を暫定的な承認行為として扱う（approvedBy を記録する）。
 * 将来的にはWebUI上の正式な承認フローに置き換える（Backlog）。
 */
import { loadAgentDefinition, loadSkillDefinition } from './skill-loader.js';

async function upsertSkillVersion(client, packId, skillId, version, { approvedByUserId }) {
  const def = loadSkillDefinition(packId, skillId, version);
  const { rows } = await client.query(
    `INSERT INTO skill_versions
       (skill_id, version, content_hash, domain_pack, owner_role, risk, status, definition_path, allowed_tools, approved_by, approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,$8,$9, now())
     ON CONFLICT (skill_id, version) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       allowed_tools = EXCLUDED.allowed_tools,
       status = 'approved',
       approved_by = EXCLUDED.approved_by,
       approved_at = now()
     RETURNING id, skill_id, version, content_hash, status`,
    [
      skillId, version, def.contentHash, packId,
      /* owner_role は execution.yaml に持たせていないため pack.yaml の owner_role を既定値にする */
      'IT/DX', def.execution.risk || 'R1', def.definitionPath,
      JSON.stringify(def.execution.allowed_tools || []), approvedByUserId,
    ],
  );
  return { row: rows[0], def };
}

async function upsertAgentVersion(client, packId, agentId, version, { approvedByUserId }) {
  const { definition, definitionPath, contentHash } = loadAgentDefinition(packId, agentId);
  const { rows } = await client.query(
    `INSERT INTO agent_versions
       (agent_id, version, content_hash, domain_pack, owner_role, status, definition_path, approved_by, approved_at)
     VALUES ($1,$2,$3,$4,$5,'approved',$6,$7, now())
     ON CONFLICT (agent_id, version) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       status = 'approved',
       approved_by = EXCLUDED.approved_by,
       approved_at = now()
     RETURNING id, agent_id, version, content_hash, status`,
    [agentId, version, contentHash, packId, definition.owner_role, definitionPath, approvedByUserId],
  );
  const agentVersionRow = rows[0];

  await client.query(`DELETE FROM agent_skill_bindings WHERE agent_version_id = $1`, [agentVersionRow.id]);
  let sortOrder = 0;
  const skillVersionRows = [];
  for (const s of definition.skills) {
    const { row: skillVersionRow } = await upsertSkillVersion(client, packId, s.skill_id, s.version, { approvedByUserId });
    await client.query(
      `INSERT INTO agent_skill_bindings (agent_version_id, skill_version_id, sort_order) VALUES ($1,$2,$3)`,
      [agentVersionRow.id, skillVersionRow.id, sortOrder++],
    );
    skillVersionRows.push(skillVersionRow);
  }

  return { agentVersion: agentVersionRow, definition, skillVersions: skillVersionRows };
}

/** 指定のAgentを（存在しなければ作成しつつ）承認済み版として同期する。 */
export async function syncAgent(client, packId, agentId, version, { approvedByUserId }) {
  return upsertAgentVersion(client, packId, agentId, version, { approvedByUserId });
}

/** 承認済み最新版のAgentVersionと、紐づくSkillVersion一覧（版固定・承認済みのみ）を取得する。 */
export async function getApprovedAgentVersion(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, agent_id, version, content_hash, status, definition_path
     FROM agent_versions WHERE agent_id = $1 AND status = 'approved' ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  if (rows.length === 0) return null;
  const agentVersion = rows[0];

  const { rows: bindings } = await client.query(
    `SELECT sv.id, sv.skill_id, sv.version, sv.content_hash, sv.status, sv.risk, sv.definition_path,
            sv.allowed_tools, b.sort_order
     FROM agent_skill_bindings b JOIN skill_versions sv ON sv.id = b.skill_version_id
     WHERE b.agent_version_id = $1 AND sv.status = 'approved'
     ORDER BY b.sort_order`,
    [agentVersion.id],
  );
  return { agentVersion, skillVersions: bindings };
}

export async function getSkillVersionById(client, skillVersionId) {
  const { rows } = await client.query(`SELECT * FROM skill_versions WHERE id = $1`, [skillVersionId]);
  return rows[0] || null;
}

/**
 * Run作成時に固定した agent_version_id から、そのRun専用のSkillVersion一覧を取得する
 * （実行時に「最新の承認済み版」へ差し替わらないようにする＝版を固定してRunする）。
 */
export async function getAgentVersionById(client, agentVersionId) {
  const { rows } = await client.query(`SELECT * FROM agent_versions WHERE id = $1`, [agentVersionId]);
  if (rows.length === 0) return null;
  const agentVersion = rows[0];
  const { rows: bindings } = await client.query(
    `SELECT sv.id, sv.skill_id, sv.version, sv.content_hash, sv.status, sv.risk, sv.definition_path,
            sv.allowed_tools, b.sort_order
     FROM agent_skill_bindings b JOIN skill_versions sv ON sv.id = b.skill_version_id
     WHERE b.agent_version_id = $1
     ORDER BY b.sort_order`,
    [agentVersionId],
  );
  return { agentVersion, skillVersions: bindings };
}
