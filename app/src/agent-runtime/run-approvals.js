/**
 * Run の承認拘束（C-13）。Skill 契約に approval_gate があれば、その Step を実行する前にアプリ内承認
 * （approval_requests, type='agent_run_step'）を要求し、Run を waiting_approval で待たせる。
 *
 * 拘束の内容（binding）: agent_version_id / skill_version_id / skill_content_hash / step_index / input_hash。
 * 承認後に Skill 版や入力が変わっていれば、その承認は無効とみなし新しい申請を作る（承認の使い回しを防ぐ）。
 * 承認は routes/approvals.js の多段階承認と同じ仕組み・同じ職務分離（申請者＝Run の起案者は判定不可）。
 * 正式な業務承認（desknet's NEO）ではなくアプリ内承認である点は ADR-001 のとおり。
 */
import { createHash } from 'node:crypto';
import { nextApprovalCode } from '../lib/codes.js';
import { recordAudit } from '../lib/audit.js';

export function inputHash(input) {
  return createHash('sha256').update(JSON.stringify(input, Object.keys(input).sort())).digest('hex');
}

export function bindingFor({ run, skillVersion, stepIndex, input }) {
  return {
    agent_version_id: Number(run.agent_version_id), skill_version_id: Number(skillVersion.id),
    skill_content_hash: skillVersion.content_hash, step_index: stepIndex, input_hash: inputHash(input),
  };
}

function sameBinding(a, b) {
  return ['agent_version_id', 'skill_version_id', 'skill_content_hash', 'step_index', 'input_hash'].every((k) => String(a?.[k]) === String(b?.[k]));
}

/**
 * 戻り値:
 *   { decision: 'proceed' }                        承認済み（拘束一致）
 *   { decision: 'wait', approval, created }        承認待ち（既存の pending か、新規作成）
 *   { decision: 'rejected', approval }             却下済み → Run を止める
 */
export async function ensureStepApproval(client, { run, skillVersion, stepIndex, input, gate }) {
  const binding = bindingFor({ run, skillVersion, stepIndex, input });
  const { rows } = await client.query(
    `SELECT id, approval_code, status, binding FROM approval_requests
     WHERE agent_run_id = $1 AND type = 'agent_run_step' AND (binding->>'step_index')::int = $2
     ORDER BY id DESC`,
    [run.id, stepIndex],
  );
  const matching = rows.find((r) => sameBinding(r.binding, binding));
  if (matching?.status === 'approved') return { decision: 'proceed', approval: matching };
  if (matching?.status === 'pending') return { decision: 'wait', approval: matching, created: false };
  if (matching?.status === 'rejected') return { decision: 'rejected', approval: matching };
  // 拘束に一致する申請がない（初回、または版・入力が変わった）→ 新規申請
  const code = await nextApprovalCode(client);
  const target = `${run.run_code} step ${stepIndex + 1}: ${skillVersion.skill_id}@${skillVersion.version}`;
  const { rows: created } = await client.query(
    `INSERT INTO approval_requests (approval_code, project_id, requested_by, type, risk, target, agent_run_id, binding)
     VALUES ($1, $2, $3, 'agent_run_step', $4, $5, $6, $7) RETURNING id, approval_code, status, binding`,
    [code, run.project_id || null, run.requested_by, skillVersion.risk || 'R2', target, run.id, JSON.stringify(binding)],
  );
  await client.query(
    `INSERT INTO approval_steps (approval_id, role, sort_order) VALUES ($1, $2, 1)`,
    [created[0].id, gate.role || 'Approver'],
  );
  await recordAudit(client, {
    actorId: null, actorType: 'agent', actorName: `agent-runtime:${run.agent_id}`,
    action: 'approval.create', resourceType: 'approval', resourceId: created[0].id,
    detail: { approvalCode: code, runCode: run.run_code, stepIndex, skillId: skillVersion.skill_id, reason: gate.reason || '', superseded: rows.length > 0 },
  });
  return { decision: 'wait', approval: created[0], created: true };
}
