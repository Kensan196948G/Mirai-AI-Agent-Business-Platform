import express from 'express';
import { getPool } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { evaluationSummary } from '../agent-runtime/evaluation-runner.js';

const router = express.Router();

router.get('/:id/versions', requireAuth, async (req, res) => {
  const { rows } = await getPool().query(
    `SELECT sv.id, sv.skill_id, sv.version, sv.content_hash, sv.status, sv.risk, sv.approved_at, u.name AS approved_by_name,
            e.total AS eval_total, e.passed AS eval_passed, e.mode AS eval_mode, e.created_at AS eval_at
     FROM skill_versions sv LEFT JOIN users u ON u.id = sv.approved_by
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total, count(*) FILTER (WHERE passed)::int AS passed, mode, MIN(created_at) AS created_at
       FROM skill_evaluations se WHERE se.skill_id = sv.skill_id AND se.content_hash = sv.content_hash
       GROUP BY batch_id, mode ORDER BY MIN(created_at) DESC LIMIT 1
     ) e ON true
     WHERE sv.skill_id = $1 ORDER BY sv.created_at DESC`,
    [req.params.id],
  );
  res.json({ versions: rows });
});

/** 評価結果（バッチごとの合格率、失敗ケース、直前バッチとの回帰）。 */
router.get('/:id/evaluations', requireAuth, async (req, res) => {
  const summary = await evaluationSummary(getPool(), { skillId: req.params.id });
  const { rows: latestCases } = summary.latest
    ? await getPool().query(`SELECT case_id, passed, details, duration_ms, cost_usd FROM skill_evaluations WHERE batch_id = $1 AND skill_id = $2 ORDER BY case_id`, [summary.latest.batch_id, req.params.id])
    : { rows: [] };
  res.json({ ...summary, latest_cases: latestCases });
});

export default router;
