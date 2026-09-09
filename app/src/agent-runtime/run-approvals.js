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
import { appendEvent, finishRun } from './job-store.js';

/** 承認の期限（時間）。既定 72 時間。J-006 */
export function approvalDeadlineHours() {
  const n = Number(process.env.APPROVAL_DEADLINE_HOURS || '72');
  return n > 0 ? n : 72;
}

/**
 * 期限切れの承認申請を expired にし、待機中の Run を理由付きで中断する（J-007）。Worker のポーリングと承認一覧 API から呼ぶ。
 * 戻り値: expired にした件数。
 */
export async function expirePendingApprovals(client) {
  const { rows } = await client.query(
    `UPDATE approval_requests SET status = 'expired', expired_at = now()
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
     RETURNING id, approval_code, type, agent_run_id, expires_at`,
  );
  for (const a of rows) {
    if (a.agent_run_id) {
      const { rows: r } = await client.query(`SELECT id, run_code, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [a.agent_run_id]);
      if (r[0] && r[0].status === 'waiting_approval') {
        await appendEvent(client, r[0].id, { type: 'cancelled', status: 'cancelled', detail: { by: 'approval_expired', approval_id: Number(a.id), expires_at: a.expires_at } });
        await finishRun(client, r[0].id, { status: 'cancelled', errorMessage: `承認期限切れにより中断（${a.approval_code}、期限 ${new Date(a.expires_at).toISOString()}）。必要なら再実行して再申請する` });
      }
    }
    await recordAudit(client, {
      actorId: null, actorType: 'service', actorName: 'approval-deadline',
      action: 'approval.expired', resourceType: 'approval', resourceId: a.id,
      detail: { approvalCode: a.approval_code, type: a.type, agentRunId: a.agent_run_id ? Number(a.agent_run_id) : null, expiresAt: a.expires_at },
    });
  }
  return rows.length;
}

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
  // returned / expired は再利用しない（Run 側は既に終端状態。再実行された Run は新しい申請を作る）
  // 拘束に一致する申請がない（初回、または版・入力が変わった）→ 新規申請
  const code = await nextApprovalCode(client);
  const target = `${run.run_code} step ${stepIndex + 1}: ${skillVersion.skill_id}@${skillVersion.version}`;
  const { rows: created } = await client.query(
    `INSERT INTO approval_requests (approval_code, project_id, requested_by, type, risk, target, agent_run_id, binding, expires_at)
     VALUES ($1, $2, $3, 'agent_run_step', $4, $5, $6, $7, now() + make_interval(hours => $8)) RETURNING id, approval_code, status, binding, expires_at`,
    [code, run.project_id || null, run.requested_by, skillVersion.risk || 'R2', target, run.id, JSON.stringify(binding), approvalDeadlineHours()],
  );
  await client.query(
    `INSERT INTO approval_steps (approval_id, role, sort_order) VALUES ($1, $2, 1)`,
    [created[0].id, gate.role || 'Approver'],
  );
  await recordAudit(client, {
    actorId: null, actorType: 'agent', actorName: `agent-runtime:${run.agent_id}`,
    action: 'approval.create', resourceType: 'approval', resourceId: created[0].id,
    detail: { approvalCode: code, runCode: run.run_code, stepIndex, skillId: skillVersion.skill_id, reason: gate.reason || '', superseded: rows.length > 0, expiresAt: created[0].expires_at },
  });
  return { decision: 'wait', approval: created[0], created: true };
}
