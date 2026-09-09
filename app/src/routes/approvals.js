import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { nextApprovalCode } from '../lib/codes.js';
import * as jobStore from '../agent-runtime/job-store.js';
import { runtimeStatus } from '../integrations/connectors.js';
import { approvalDeadlineHours, expirePendingApprovals } from '../agent-runtime/run-approvals.js';

const router = express.Router();

/**
 * Agent Run の Step 承認（type=agent_run_step）が確定したら Run を再開（queued）または中断する。
 * 再開時の再検証（Skill 版・入力の一致）は Worker 側の ensureStepApproval が行う。
 */
async function syncRunOnDecision(client, approval, decision, actor, reason = '') {
  if (approval.type !== 'agent_run_step' || !approval.agent_run_id) return;
  const { rows } = await client.query(`SELECT id, run_code, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [approval.agent_run_id]);
  const run = rows[0];
  if (!run || run.status !== 'waiting_approval') return;
  if (decision === 'approved') {
    await jobStore.resumeRun(client, run.id);
    await jobStore.appendEvent(client, run.id, { type: 'resumed', status: 'ok', detail: { by: 'approval', approval_id: Number(approval.id) } });
  } else if (decision === 'returned') {
    // 差戻し（J-008）: 却下ではなく「入力・前提を修正して再申請」を求める。Run は再開できないため failed（理由付き）で終端し、再実行で新しい申請を作る
    await jobStore.appendEvent(client, run.id, { type: 'returned', status: 'returned', detail: { by: 'approval_returned', approval_id: Number(approval.id), reason: reason || '' } });
    await jobStore.finishRun(client, run.id, { status: 'failed', errorMessage: `承認者による差戻し（approval ${approval.id}）: ${reason || ''}。入力・前提を修正して再実行（再申請）してください` });
  } else {
    await jobStore.appendEvent(client, run.id, { type: 'cancelled', status: 'cancelled', detail: { by: 'approval_rejected', approval_id: Number(approval.id), reason: reason || '' } });
    await jobStore.finishRun(client, run.id, { status: 'cancelled', errorMessage: `承認却下により中断（approval ${approval.id}）: ${reason || ''}` });
  }
  await recordAudit(client, {
    actorId: actor.id, actorType: 'user', actorName: actor.name,
    action: decision === 'approved' ? 'agent_run.resume' : decision === 'returned' ? 'agent_run.returned' : 'agent_run.cancelled', resourceType: 'agent_run', resourceId: run.id,
    detail: { runCode: run.run_code, via: 'approval', approvalId: Number(approval.id), reason: reason || null },
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
    `INSERT INTO approval_requests (approval_code, project_id, requested_by, type, risk, target, target_status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8))
     RETURNING id, approval_code, type, risk, target, status, target_status, created_at, expires_at`,
    [approvalCode, projectId, requestedBy, type, risk, target, targetStatus ?? null, approvalDeadlineHours()],
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
  // J-007: 一覧のたびに期限切れを反映する（Worker のポーリングでも行うが、API 側でも遅延なく見せる）
  await withTransaction((client) => expirePendingApprovals(client)).catch(() => {});
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.approval_code, ar.type, ar.risk, ar.target, ar.status, ar.created_at, ar.decided_at, ar.target_status, ar.expires_at, ar.expired_at,
            ar.external_ref, ar.external_ref_status,
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
            ar.external_ref, ar.external_ref_status, ar.external_ref_note, ar.external_ref_updated_at,
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
  if (!['approved', 'rejected', 'returned'].includes(decision)) {
    return res.status(400).json({ error: 'decision は approved / rejected / returned（差戻し）のいずれか' });
  }
  const reasonText = typeof reason === 'string' ? reason.trim() : '';

  try {
    const result = await withTransaction(async (client) => {
      const { rows: aprRows } = await client.query(
        `SELECT id, project_id, status, target_status, requested_by, type, agent_run_id, expires_at FROM approval_requests WHERE id = $1 FOR UPDATE`,
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
      // J-009 / J-010: 判定には理由（Evidence）が必須。期限切れの申請は判定できない
      if (aprRows[0].expires_at && new Date(aprRows[0].expires_at) < new Date()) {
        throw Object.assign(new Error('この申請は期限切れです（一覧で expired に更新されます）。再申請が必要です'), { status: 409 });
      }
      if (reasonText.length < 2) {
        throw Object.assign(new Error('判定には理由（reason、2 文字以上）が必須です。確認した根拠・判断理由を記録してください'), { status: 422 });
      }

      await client.query(
        `UPDATE approval_steps SET status = $1, decided_at = now(), reason = $2, assigned_user_id = $3 WHERE id = $4`,
        [decision, reasonText, req.user.id, stepId],
      );

      if (decision === 'rejected' || decision === 'returned') {
        await client.query(`UPDATE approval_requests SET status = $3, decided_by = $1, decided_at = now(), comment = $4 WHERE id = $2`, [req.user.id, approvalId, decision, reasonText]);
        await syncRunOnDecision(client, aprRows[0], decision, req.user, reasonText);
        await recordAudit(client, {
          actorId: req.user.id, actorType: 'user', actorName: req.user.name,
          action: decision === 'rejected' ? 'approval.rejected' : 'approval.returned', resourceType: 'approval', resourceId: approvalId, detail: { step: step.role, reason: reasonText },
        });
        return { approval_id: approvalId, status: decision };
      }

      const remaining = steps.slice(stepIdx + 1);
      if (remaining.length === 0) {
        // 最終stepの承認 → approval確定 + Projectへ反映
        await client.query(`UPDATE approval_requests SET status = 'approved', decided_by = $1, decided_at = now(), comment = $3 WHERE id = $2`, [req.user.id, approvalId, reasonText]);
        if (aprRows[0].target_status && aprRows[0].project_id) {
          await client.query(`UPDATE projects SET status = $1 WHERE id = $2`, [aprRows[0].target_status, aprRows[0].project_id]);
        }
        await syncRunOnDecision(client, aprRows[0], 'approved', req.user, reasonText);
        await recordAudit(client, {
          actorId: req.user.id, actorType: 'user', actorName: req.user.name,
          action: 'approval.approved', resourceType: 'approval', resourceId: approvalId,
          detail: { step: step.role, target_status: aprRows[0].target_status, reason: reasonText },
        });
        return { approval_id: approvalId, status: 'approved', project_status: aprRows[0].target_status };
      }

      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'approval.step_approved', resourceType: 'approval', resourceId: approvalId,
        detail: { step: step.role, next_step: remaining[0].role, reason: reasonText },
      });
      return { approval_id: approvalId, status: 'in_review', next_step: remaining[0].role };
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 正式承認（desknet's NEO）の承認番号を控える（D-20）。
 * 手入力の番号は必ず 'unverified' で保存し、承認の成立には使わない。'verified' にできるのは NEO 連携で検証できた場合だけ。
 */
router.patch('/:id/external-ref', requireAuth, requireRole('Administrator', 'Approver'), async (req, res) => {
  const id = Number(req.params.id);
  const { externalRef, note } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (!externalRef || typeof externalRef !== 'string' || externalRef.length > 100) return res.status(400).json({ error: 'externalRef は 100 文字以内の文字列' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE approval_requests SET external_ref = $1, external_ref_status = 'unverified', external_ref_note = $2, external_ref_updated_at = now()
         WHERE id = $3 RETURNING id, approval_code, external_ref, external_ref_status`,
        [externalRef.trim(), note || null, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('approval が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'approval.external_ref', resourceType: 'approval', resourceId: id, detail: { external_ref: externalRef.trim(), status: 'unverified' },
      });
      return rows[0];
    });
    res.json({ approval: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** NEO で検証する（連携未接続の間は blocked: 501。手動で verified にする手段は用意しない）。 */
router.post('/:id/external-ref/verify', requireAuth, requireRole('Administrator', 'Approver'), async (req, res) => {
  const rs = runtimeStatus('neo');
  if (!rs.configured || rs.spec === 'unconfirmed') {
    return res.status(501).json({ error: `正式承認の検証は blocked: ${rs.blocked_reason}。承認番号は「未検証」のままです`, blocked: true, runtime: rs });
  }
  return res.status(501).json({ error: '正式承認の検証 API は仕様確認後に実装します', blocked: true, runtime: rs });
});

export default router;
