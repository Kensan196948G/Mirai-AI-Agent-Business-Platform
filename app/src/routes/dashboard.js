import express from 'express';
import { getPool } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  const pool = getPool();

  const [projectCount, pipeline, recentProjects, recentTasks, pendingApprovals, usage, knowledgePending, taskCounts] =
    await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM projects`),
      pool.query(`SELECT status, count(*)::int AS n FROM projects GROUP BY status`),
      pool.query(
        `SELECT p.id, p.project_code, p.title, p.status, u.name AS owner_name
         FROM projects p LEFT JOIN users u ON u.id = p.owner_id
         ORDER BY p.created_at DESC LIMIT 5`,
      ),
      pool.query(
        `SELECT t.id, t.task_code, t.title, t.agent_name, t.model, t.cost, t.status
         FROM tasks t ORDER BY t.occurred_at DESC LIMIT 4`,
      ),
      pool.query(
        `SELECT ar.id, ar.approval_code, ar.type, ar.risk, ar.target, ar.created_at, p.project_code, p.title, u.name AS requested_by_name
         FROM approval_requests ar JOIN projects p ON p.id = ar.project_id JOIN users u ON u.id = ar.requested_by
         WHERE ar.status = 'pending' ORDER BY ar.created_at ASC LIMIT 5`,
      ),
      pool.query(
        `SELECT provider, SUM(cost)::float AS cost, SUM(tokens_in + tokens_out)::bigint AS tokens, COUNT(*)::int AS runs
         FROM tasks GROUP BY provider ORDER BY cost DESC`,
      ),
      pool.query(
        `SELECT id, kc_code, title, type, score FROM knowledge_candidates WHERE status = 'pending' ORDER BY score DESC LIMIT 5`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM tasks GROUP BY status`,
      ),
    ]);

  const taskStatusMap = Object.fromEntries(taskCounts.rows.map((r) => [r.status, r.n]));
  const totalCost = usage.rows.reduce((sum, r) => sum + Number(r.cost), 0);
  const totalTokens = usage.rows.reduce((sum, r) => sum + Number(r.tokens), 0);

  res.json({
    kpis: {
      activeProjects: pipeline.rows.filter((r) => ['active', 'staging'].includes(r.status)).reduce((s, r) => s + r.n, 0),
      totalProjects: projectCount.rows[0].n,
      pendingApprovals: pendingApprovals.rows.length,
      runningTasks: taskStatusMap.running || 0,
      blockedTasks: taskStatusMap.blocked || 0,
      failedTasks: taskStatusMap.failed || 0,
      aiCostThisMonth: totalCost,
      totalTokens,
      providerCount: usage.rows.length,
    },
    pipeline: pipeline.rows,
    recentProjects: recentProjects.rows,
    recentTasks: recentTasks.rows,
    pendingApprovals: pendingApprovals.rows,
    usage: usage.rows,
    knowledgePending: knowledgePending.rows,
    knowledgePendingCount: knowledgePending.rows.length,
  });
});

export default router;
