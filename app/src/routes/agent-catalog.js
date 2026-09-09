/**
 * 業務Agent カタログと版承認 API（WebUI「業務Agent」画面用）。
 *  GET  /api/agent-catalog            承認済み最新版の Agent 一覧（用途・できないこと・Skill版）
 *  GET  /api/agent-catalog/versions   Skill版・Agent版の一覧（draft/approved/deprecated）
 *  POST /api/agent-catalog/versions/:kind/:id/approve    Administrator が draft を承認
 *  POST /api/agent-catalog/versions/:kind/:id/deprecate  Administrator が承認を取り消す
 * kind は 'skill' | 'agent'。承認は正式なGate承認（desknet's NEO）とは別の「Runtime内の版承認」。
 */
import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { loadAgentDefinition, SkillLoaderError } from '../agent-runtime/skill-loader.js';
import { approveVersion, deprecateVersion } from '../agent-runtime/registry.js';
import { catalogWithRuntime } from '../agent-runtime/catalog.js';

const router = express.Router();
const TABLE = { skill: 'skill_versions', agent: 'agent_versions' };

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (agent_id) id, agent_id, version, domain_pack, owner_role, status, approved_at
     FROM agent_versions ORDER BY agent_id, created_at DESC`,
  );
  const agents = [];
  for (const r of rows) {
    let def = null;
    try {
      def = loadAgentDefinition(r.domain_pack, r.agent_id).definition;
    } catch (err) {
      if (!(err instanceof SkillLoaderError)) throw err;
    }
    const { rows: skills } = await getPool().query(
      `SELECT sv.skill_id, sv.version, sv.status FROM agent_skill_bindings b
       JOIN skill_versions sv ON sv.id = b.skill_version_id WHERE b.agent_version_id = $1 ORDER BY b.sort_order`,
      [r.id],
    );
    agents.push({
      agent_id: r.agent_id, version: r.version, status: r.status, owner_role: r.owner_role,
      approved_at: r.approved_at,
      title: def?.title ?? r.agent_id, purpose: def?.purpose ?? '', does_not: def?.does_not ?? '',
      max_autonomy_level: def?.max_autonomy_level ?? null,
      runnable: r.status === 'approved' && skills.length > 0 && skills.every((s) => s.status === 'approved'),
      skills,
    });
  }
  res.json({ agents });
});

/** 組織 × Agent の統合カタログ（org-map.yaml + P1 定義 + P2/P3 候補 + 承認状態）。AI相談の「近い Agent」と部署別一覧の正本。 */
router.get('/org', requireAuth, async (_req, res) => {
  res.json(await catalogWithRuntime(getPool()));
});

router.get('/versions', requireAuth, async (_req, res) => {
  const { rows: skills } = await getPool().query(
    `SELECT sv.id, sv.skill_id AS name, sv.version, sv.status, sv.risk, sv.content_hash, sv.approved_at, u.name AS approved_by_name,
            e.total AS eval_total, e.passed AS eval_passed, e.mode AS eval_mode, e.created_at AS eval_at
     FROM skill_versions sv LEFT JOIN users u ON u.id = sv.approved_by
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total, count(*) FILTER (WHERE passed)::int AS passed, mode, MIN(created_at) AS created_at
       FROM skill_evaluations se WHERE se.skill_id = sv.skill_id AND se.content_hash = sv.content_hash
       GROUP BY batch_id, mode ORDER BY MIN(created_at) DESC LIMIT 1
     ) e ON true
     ORDER BY sv.skill_id, sv.created_at DESC`,
  );
  const { rows: agents } = await getPool().query(
    `SELECT av.id, av.agent_id AS name, av.version, av.status, av.owner_role, av.content_hash, av.approved_at, u.name AS approved_by_name
     FROM agent_versions av LEFT JOIN users u ON u.id = av.approved_by ORDER BY av.agent_id, av.created_at DESC`,
  );
  res.json({ skills, agents });
});

async function changeStatus(req, res, action) {
  const table = TABLE[req.params.kind];
  const id = Number(req.params.id);
  if (!table || !Number.isInteger(id)) return res.status(400).json({ error: '不正な kind / id' });
  try {
    const result = await withTransaction(async (client) => {
      const row = action === 'approve'
        ? await approveVersion(client, table, id, { approvedByUserId: req.user.id })
        : await deprecateVersion(client, table, id);
      if (!row) throw Object.assign(new Error('対象の版が見つからないか、状態が変更できません'), { status: 409 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: `${req.params.kind}_version.${action}`, resourceType: `${req.params.kind}_version`, resourceId: id,
        detail: { name: row.skill_id || row.agent_id, version: row.version, content_hash: row.content_hash },
      });
      return row;
    });
    res.json({ version: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

router.post('/versions/:kind/:id/approve', requireAuth, requireRole('Administrator'), (req, res) => changeStatus(req, res, 'approve'));
router.post('/versions/:kind/:id/deprecate', requireAuth, requireRole('Administrator'), (req, res) => changeStatus(req, res, 'deprecate'));

export default router;
