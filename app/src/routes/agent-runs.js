import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import * as registry from '../agent-runtime/registry.js';
import * as jobStore from '../agent-runtime/job-store.js';
import { authorizeRunStart, PolicyDeniedError } from '../agent-runtime/policy-engine.js';

const router = express.Router();

const AGENT_RUN_BUDGET_USD = Number(process.env.AGENT_RUN_BUDGET_USD || '0.50');

// エージェントごとに受け付ける input_json のキーを固定する（利用者が任意のキーを混入できないようにする）。
const AGENT_INPUT_ALLOWLIST = {
  'technology-selection': ['query'],
  'project-case-research': ['query'],
  'knowledge-quality': ['knowledge_candidate_id', 'title', 'summary', 'source'],
};

function pickAllowed(input, keys) {
  const out = {};
  for (const k of keys) if (input[k] !== undefined) out[k] = input[k];
  return out;
}

router.post('/', requireAuth, async (req, res) => {
  const { agentId, projectId, input } = req.body || {};
  if (!agentId || !AGENT_INPUT_ALLOWLIST[agentId]) {
    return res.status(400).json({ error: '不正な agentId' });
  }
  try {
    authorizeRunStart({ user: req.user });
  } catch (err) {
    return res.status(err instanceof PolicyDeniedError ? 403 : 500).json({ error: err.message });
  }

  try {
    const result = await withTransaction(async (client) => {
      const agentVersionInfo = await registry.getApprovedAgentVersion(client, agentId);
      if (!agentVersionInfo) {
        throw Object.assign(new Error(`Agent「${agentId}」の承認済み版がありません`), { status: 409 });
      }
      const run = await jobStore.createRun(client, {
        agentId,
        agentVersionId: agentVersionInfo.agentVersion.id,
        projectId: projectId || null,
        requestedBy: req.user.id,
        inputJson: pickAllowed(input || {}, AGENT_INPUT_ALLOWLIST[agentId]),
        maxSteps: 8,
      });
      await jobStore.reserveBudget(client, run.id, AGENT_RUN_BUDGET_USD);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.create', resourceType: 'agent_run', resourceId: run.id,
        detail: { agentId, runCode: run.run_code },
      });
      return run;
    });
    res.status(201).json({ run: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.run_code, ar.agent_id, ar.status, ar.current_step, ar.max_steps, ar.project_id,
            ar.created_at, ar.finished_at, ar.error_message, u.name AS requested_by_name, p.project_code
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     ORDER BY ar.created_at DESC LIMIT 100`,
  );
  res.json({ runs: rows });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT ar.*, u.name AS requested_by_name, p.project_code
     FROM agent_runs ar JOIN users u ON u.id = ar.requested_by
     LEFT JOIN projects p ON p.id = ar.project_id
     WHERE ar.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'run が見つかりません' });
  const { rows: artifacts } = await getPool().query(
    `SELECT id, artifact_code, kind, title, review_state, created_at FROM artifacts WHERE run_id = $1 ORDER BY id`,
    [id],
  );
  res.json({ run: rows[0], artifacts });
});

router.get('/:id/events', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT seq, type, skill_id, skill_version, tool_name, status, detail, tokens_in, tokens_out, cost, created_at
     FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [id],
  );
  res.json({ events: rows });
});

router.post('/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT requested_by, status FROM agent_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (Number(rows[0].requested_by) !== Number(req.user.id) && req.user.role !== 'Administrator') {
        throw Object.assign(new Error('この Run をキャンセルする権限がありません'), { status: 403 });
      }
      if (['completed', 'failed', 'cancelled'].includes(rows[0].status)) {
        throw Object.assign(new Error(`既に終了しています（現在: ${rows[0].status}）`), { status: 409 });
      }
      await jobStore.requestCancel(client, id);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.cancel_requested', resourceType: 'agent_run', resourceId: id, detail: {},
      });
      return { id, cancel_requested: true };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/resume', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT status, agent_id FROM agent_runs WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw Object.assign(new Error('run が見つかりません'), { status: 404 });
      if (!['paused', 'waiting_approval'].includes(rows[0].status)) {
        throw Object.assign(new Error(`再開できない状態です（現在: ${rows[0].status}）`), { status: 409 });
      }
      // 再開時は権限・承認済み版を再検証する（版が失効していれば queued へ戻さない）。
      const agentVersionInfo = await registry.getApprovedAgentVersion(client, rows[0].agent_id);
      if (!agentVersionInfo) {
        throw Object.assign(new Error('Agentの承認済み版が失効しているため再開できません'), { status: 409 });
      }
      await jobStore.resumeRun(client, id);
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'agent_run.resume', resourceType: 'agent_run', resourceId: id, detail: {},
      });
      return { id, status: 'queued' };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
