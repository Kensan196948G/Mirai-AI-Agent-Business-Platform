import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { availableTransitions, findTransition, phaseIndex, PHASES } from '../lib/workflow.js';
import { createApprovalWithSteps } from './approvals.js';

const router = express.Router();

const PROJECT_COLUMNS = `
  p.id, p.project_code, p.title, p.description, p.status, p.risk,
  p.repo, p.notion_ref, p.slack_ref, p.created_at,
  p.owner_id, u.name AS owner_name, u.dept AS owner_dept
`;

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS} FROM projects p LEFT JOIN users u ON u.id = p.owner_id ORDER BY p.created_at DESC`,
  );
  if (rows.length === 0) return res.json({ projects: [] });

  // KPIをまとめて取得し埋め込む（一覧取得だけで詳細画面に必要な情報を揃え、選択のたびの追加リクエストを避ける）
  const { rows: allKpis } = await getPool().query(
    `SELECT project_id, id, name, target, current, unit FROM project_kpis WHERE project_id = ANY($1::bigint[]) ORDER BY sort_order, id`,
    [rows.map((r) => r.id)],
  );
  const kpisByProject = new Map();
  for (const k of allKpis) {
    if (!kpisByProject.has(k.project_id)) kpisByProject.set(k.project_id, []);
    kpisByProject.get(k.project_id).push(k);
  }

  res.json({ projects: rows.map((r) => withPhase({ ...r, kpis: kpisByProject.get(r.id) || [] })) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });

  const { rows: projRows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS} FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [id],
  );
  if (projRows.length === 0) return res.status(404).json({ error: 'project が見つかりません' });
  const project = withPhase(projRows[0]);

  const { rows: kpis } = await getPool().query(
    `SELECT id, name, target, current, unit FROM project_kpis WHERE project_id = $1 ORDER BY sort_order, id`,
    [id],
  );
  const { rows: approvals } = await getPool().query(
    `SELECT ar.id, ar.approval_code, ar.type, ar.risk, ar.target, ar.status, ar.target_status, ar.created_at, ar.decided_at, u.name AS decided_by_name
     FROM approval_requests ar LEFT JOIN users u ON u.id = ar.decided_by
     WHERE ar.project_id = $1 ORDER BY ar.created_at DESC`,
    [id],
  );
  const { rows: tasks } = await getPool().query(
    `SELECT id, task_code, title, status, agent_name FROM tasks WHERE project_id = $1 ORDER BY occurred_at DESC`,
    [id],
  );

  res.json({
    project,
    kpis,
    approvals,
    tasks,
    transitions: availableTransitions(project.status),
  });
});

router.patch('/:id', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { ownerId, risk, repo, notionRef, slackRef } = req.body || {};

  const fields = [];
  const values = [];
  let i = 1;
  if (ownerId !== undefined) { fields.push(`owner_id = $${i++}`); values.push(ownerId); }
  if (risk !== undefined) { fields.push(`risk = $${i++}`); values.push(risk); }
  if (repo !== undefined) { fields.push(`repo = $${i++}`); values.push(repo); }
  if (notionRef !== undefined) { fields.push(`notion_ref = $${i++}`); values.push(notionRef); }
  if (slackRef !== undefined) { fields.push(`slack_ref = $${i++}`); values.push(slackRef); }
  if (fields.length === 0) return res.status(400).json({ error: '更新項目がありません' });

  values.push(id);
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE projects SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`,
        values,
      );
      if (rows.length === 0) throw Object.assign(new Error('project が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'project.update', resourceType: 'project', resourceId: id,
        detail: { ownerId, risk, repo, notionRef, slackRef },
      });
      return rows[0];
    });
    res.json({ status: 'ok', project: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/kpis', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const projectId = Number(req.params.id);
  const { name, target, current, unit } = req.body || {};
  if (!Number.isInteger(projectId) || !name || target === undefined) {
    return res.status(400).json({ error: 'name, target は必須' });
  }
  const { rows } = await getPool().query(
    `INSERT INTO project_kpis (project_id, name, target, current, unit) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, target, current, unit`,
    [projectId, name, target, current ?? 0, unit ?? ''],
  );
  res.status(201).json({ kpi: rows[0] });
});

router.post('/:id/transition', requireAuth, requireRole('Administrator', 'Developer', 'Approver'), async (req, res) => {
  const id = Number(req.params.id);
  const { to } = req.body || {};
  if (!Number.isInteger(id) || !to) return res.status(400).json({ error: 'to は必須' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT id, project_code, title, status FROM projects WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('project が見つかりません'), { status: 404 });
      const project = rows[0];

      const transition = findTransition(project.status, to);
      if (!transition) {
        throw Object.assign(new Error(`許可されない遷移です（現在: ${project.status} → ${to}）`), { status: 409 });
      }

      if (transition.approval) {
        const approval = await createApprovalWithSteps(client, {
          projectId: id,
          requestedBy: req.user.id,
          type: transition.approval,
          risk: transition.risk,
          target: `${project.project_code} を「${to}」へ遷移`,
          targetStatus: to,
        });
        await recordAudit(client, {
          actorId: req.user.id, actorType: 'user', actorName: req.user.name,
          action: 'project.transition_requested', resourceType: 'project', resourceId: id,
          detail: { to, approval_id: approval.id },
        });
        return { pending_approval: approval };
      }

      await client.query(`UPDATE projects SET status = $1 WHERE id = $2`, [to, id]);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'project.transition', resourceType: 'project', resourceId: id, detail: { from: project.status, to },
      });
      return { project: { id, status: to } };
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function withPhase(project) {
  return { ...project, phase_index: phaseIndex(project.status), phases: PHASES };
}

export default router;
