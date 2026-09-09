import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { nextApprovalCode } from '../lib/codes.js';
import * as jobStore from '../agent-runtime/job-store.js';

const router = express.Router();

/**
 * Agent Run の Step 承認（type=agent_run_step）が確定したら Run を再開（queued）または中断する。
 * 再開時の再検証（Skill 版・入力の一致）は Worker 側の ensureStepApproval が行う。
 */
async function syncRunOnDecision(client, approval, decision, actor) {
  if (approval.type !== 'agent_run_step' || !approval.agent_run_id) return;
  const { rows } = await client.query(`SELECT id, run_code, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [approval.agent_run_id]);
  const run = rows[0];
  if (!run || run.status !== 'waiting_approval') return;
  if (decision === 'approved') {
    await jobStore.resumeRun(client, run.id);
    await jobStore.appendEvent(client, run.id, { type: 'resumed', status: 'ok', detail: { by: 'approval', approval_id: Number(approval.id) } });
  } else {
    await jobStore.appendEvent(client, run.id, { type: 'cancelled', status: 'cancelled', detail: { by: 'approval_rejected', approval_id: Number(approval.id) } });
    await jobStore.finishRun(client, run.id, { status: 'cancelled', errorMessage: `承認却下により中断（approval ${approval.id}）` });
  }
  await recordAudit(client, {
    actorId: actor.id, actorType: 'user', actorName: actor.name,
    action: decision === 'approved' ? 'agent_run.resume' : 'agent_run.cancelled', resourceType: 'agent_run', resourceId: run.id,
    detail: { runCode: run.run_code, via: 'approval', approvalId: Number(approval.id) },
  });
}

/** type ごとの承認ステップ構成。project_gate は Approver 1段、production_release はより高リスクのため Reviewer→Approver の2段。 */
const STEP_PLANS = {
  project_gate: ['Approver'],
  production_release: ['Reviewer', 'Approver'],
  github_merge: ['Reviewer', 'Approver'],
  budget: ['Approver'],
};

export async function createApprovalWithSteps(client, { projectId, requestedBy, type, risk, target, targetStatus }) {
  const approvalCode = await nextApprovalCode(client);
  const { rows: aprRows } = await client.query(
    `INSERT INTO approval_requests (approval_code, project_id, requested_by, type, risk, target, target_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, approval_code, type, risk, target, status, target_status, created_at`,
    [approvalCode, projectId, requestedBy, type, risk, target, targetStatus ?? null],
  );
  const approval = aprRows[0];
  const roles = STEP_PLANS[type] || ['Approver'];
  for (let i = 0; i < roles.length; i++) {
    await client.query(
      `INSERT INTO approval_steps (approval_id, role, sort_order) VALUES ($1, $2, $3)`,
      [approval.id, roles[i], i],
    );
  }
  return approval;
}

// 一覧は全件返す（pending/approved/rejected）。ダッシュボードの「承認待ち」表示は
// フロント側で status='pending' のものだけを絞り込む（他の一覧APIと同じ設計に揃える）。
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.approval_code, ar.type, ar.risk, ar.target, ar.status, ar.created_at, ar.decided_at, ar.target_status,
            p.id AS project_id, p.project_code, p.title, u.name AS requested_by_name
     , ar.agent_run_id, r.run_code
     FROM approval_requests ar
     LEFT JOIN projects p ON p.id = ar.project_id
     LEFT JOIN agent_runs r ON r.id = ar.agent_run_id
     JOIN users u ON u.id = ar.requested_by
     ORDER BY ar.created_at DESC`,
  );
  if (rows.length === 0) return res.json({ approvals: [] });

  const { rows: allSteps } = await getPool().query(
    `SELECT s.approval_id, s.id, s.role, s.status, s.decided_at, s.reason, s.sort_order, u.name AS assigned_user_name
     FROM approval_steps s LEFT JOIN users u ON u.id = s.assigned_user_id
     WHERE s.approval_id = ANY($1::bigint[]) ORDER BY s.sort_order`,
    [rows.map((r) => r.id)],
  );
  const stepsByApproval = new Map();
  for (const s of allSteps) {
    if (!stepsByApproval.has(s.approval_id)) stepsByApproval.set(s.approval_id, []);
    stepsByApproval.get(s.approval_id).push(s);
  }

  res.json({ approvals: rows.map((r) => ({ ...r, steps: stepsByApproval.get(r.id) || [] })) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.approval_code, ar.type, ar.risk, ar.target, ar.status, ar.target_status, ar.created_at, ar.binding,
            p.id AS project_id, p.project_code, p.title, ar.agent_run_id, r.run_code
     FROM approval_requests ar LEFT JOIN projects p ON p.id = ar.project_id LEFT JOIN agent_runs r ON r.id = ar.agent_run_id
     WHERE ar.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'approval が見つかりません' });
  const { rows: steps } = await getPool().query(
    `SELECT s.id, s.role, s.status, s.decided_at, s.reason, s.sort_order, u.name AS assigned_user_name
     FROM approval_steps s LEFT JOIN users u ON u.id = s.assigned_user_id
     WHERE s.approval_id = $1 ORDER BY s.sort_order`,
    [id],
  );
  res.json({ approval: rows[0], steps });
});

router.post('/:id/steps/:stepId/decide', requireAuth, async (req, res) => {
  const approvalId = Number(req.params.id);
  const stepId = Number(req.params.stepId);
  const { decision, reason } = req.body || {};
  if (!Number.isInteger(approvalId) || !Number.isInteger(stepId)) return res.status(400).json({ error: '不正な id' });
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision は approved / rejected のいずれか' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const { rows: aprRows } = await client.query(
        `SELECT id, project_id, status, target_status, requested_by, type, agent_run_id FROM approval_requests WHERE id = $1 FOR UPDATE`,
        [approvalId],
      );
      if (aprRows.length === 0) throw Object.assign(new Error('approval が見つかりません'), { status: 404 });
      if (aprRows[0].status !== 'pending') {
        throw Object.assign(new Error(`既に判定済みです（現在: ${aprRows[0].status}）`), { status: 409 });
      }
      // SoD: 申請者本人は自分の申請を承認・却下できない（Administratorであっても例外にしない）。
      if (Number(aprRows[0].requested_by) === Number(req.user.id)) {
        throw Object.assign(new Error('申請者本人はこの承認を判定できません（職務分離）'), { status: 403 });
      }

      const { rows: steps } = await client.query(
        `SELECT id, role, status, sort_order FROM approval_steps WHERE approval_id = $1 ORDER BY sort_order FOR UPDATE`,
        [approvalId],
      );
      // pg は BIGINT を文字列として返すため Number() で正規化してから比較する
      const stepIdx = steps.findIndex((s) => Number(s.id) === stepId);
      if (stepIdx === -1) throw Object.assign(new Error('step が見つかりません'), { status: 404 });
      const step = steps[stepIdx];
      if (step.status !== 'pending') {
        throw Object.assign(new Error(`既に判定済みのstepです（現在: ${step.status}）`), { status: 409 });
      }
      // 前段のstepが未承認のうちは後段を判定できない（順序どおりの多段階承認）
      const priorPending = steps.slice(0, stepIdx).some((s) => s.status !== 'approved');
      if (priorPending) throw Object.assign(new Error('前段のstepが未承認です'), { status: 409 });
      if (req.user.role !== step.role && req.user.role !== 'Administrator') {
        throw Object.assign(new Error(`このstepの権限がありません（必要ロール: ${step.role}）`), { status: 403 });
      }

      await client.query(
        `UPDATE approval_steps SET status = $1, decided_at = now(), reason = $2, assigned_user_id = $3 WHERE id = $4`,
        [decision, reason || null, req.user.id, stepId],
      );

      if (decision === 'rejected') {
        await client.query(`UPDATE approval_requests SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2`, [req.user.id, approvalId]);
        await syncRunOnDecision(client, aprRows[0], 'rejected', req.user);
        await recordAudit(client, {
          actorId: req.user.id, actorType: 'user', actorName: req.user.name,
          action: 'approval.rejected', resourceType: 'approval', resourceId: approvalId, detail: { step: step.role, reason },
        });
        return { approval_id: approvalId, status: 'rejected' };
      }

      const remaining = steps.slice(stepIdx + 1);
      if (remaining.length === 0) {
        // 最終stepの承認 → approval確定 + Projectへ反映
        await client.query(`UPDATE approval_requests SET status = 'approved', decided_by = $1, decided_at = now() WHERE id = $2`, [req.user.id, approvalId]);
        if (aprRows[0].target_status && aprRows[0].project_id) {
          await client.query(`UPDATE projects SET status = $1 WHERE id = $2`, [aprRows[0].target_status, aprRows[0].project_id]);
        }
        await syncRunOnDecision(client, aprRows[0], 'approved', req.user);
        await recordAudit(client, {
          actorId: req.user.id, actorType: 'user', actorName: req.user.name,
          action: 'approval.approved', resourceType: 'approval', resourceId: approvalId,
          detail: { step: step.role, target_status: aprRows[0].target_status },
        });
        return { approval_id: approvalId, status: 'approved', project_status: aprRows[0].target_status };
      }

      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'approval.step_approved', resourceType: 'approval', resourceId: approvalId,
        detail: { step: step.role, next_step: remaining[0].role },
      });
      return { approval_id: approvalId, status: 'in_review', next_step: remaining[0].role };
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
