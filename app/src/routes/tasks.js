import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

async function nextTaskCode(client) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM tasks`);
  return `T-${1000 + rows[0].n + 1}`;
}

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT t.id, t.task_code, t.title, t.agent_name, t.provider, t.model, t.status,
            t.tokens_in, t.tokens_out, t.cost, t.latency_ms, t.occurred_at, t.error_message,
            p.project_code, ar.approval_code AS blocked_by_code
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN approval_requests ar ON ar.id = t.blocked_by_approval_id
     ORDER BY t.occurred_at DESC`,
  );
  if (rows.length === 0) return res.json({ tasks: [] });

  // Tool Call をまとめて取得し埋め込む（詳細画面用の追加リクエストを避ける）
  const { rows: allTools } = await getPool().query(
    `SELECT task_id, name, risk, decision FROM task_tool_calls WHERE task_id = ANY($1::bigint[]) ORDER BY sort_order`,
    [rows.map((r) => r.id)],
  );
  const toolsByTask = new Map();
  for (const t of allTools) {
    if (!toolsByTask.has(t.task_id)) toolsByTask.set(t.task_id, []);
    toolsByTask.get(t.task_id).push(t);
  }

  res.json({ tasks: rows.map((r) => ({ ...r, toolCalls: toolsByTask.get(r.id) || [] })) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  const { rows } = await getPool().query(
    `SELECT t.*, p.project_code FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'task が見つかりません' });
  const { rows: toolCalls } = await getPool().query(
    `SELECT name, risk, decision FROM task_tool_calls WHERE task_id = $1 ORDER BY sort_order`,
    [id],
  );
  res.json({ task: rows[0], toolCalls });
});

router.post('/', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const { projectId, title, agentName, provider, model, status, tokensIn, tokensOut, cost, latencyMs } = req.body || {};
  if (!projectId || !title || !agentName || !provider || !model) {
    return res.status(400).json({ error: 'projectId, title, agentName, provider, model は必須' });
  }
  try {
    const result = await withTransaction(async (client) => {
      const taskCode = await nextTaskCode(client);
      const { rows } = await client.query(
        `INSERT INTO tasks (task_code, project_id, title, agent_name, provider, model, status,
                             tokens_in, tokens_out, cost, latency_ms, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, task_code, title, status`,
        [taskCode, projectId, title, agentName, provider, model, status || 'pending',
         tokensIn || 0, tokensOut || 0, cost || 0, latencyMs || 0, req.user.id],
      );
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'task.create', resourceType: 'task', resourceId: rows[0].id, detail: { taskCode },
      });
      return rows[0];
    });
    res.status(201).json({ task: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/:id', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const id = Number(req.params.id);
  const { status, errorMessage, tokensIn, tokensOut, cost, latencyMs } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (status && !['pending', 'ready', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: '不正な status' });
  }
  try {
    const result = await withTransaction(async (client) => {
      const { rows: current } = await client.query(`SELECT status, source FROM tasks WHERE id = $1 FOR UPDATE`, [id]);
      if (current.length === 0) throw Object.assign(new Error('task が見つかりません'), { status: 404 });
      // Runtime管理のTask（Agent Runと連動）は、このAPIから直接書き換えられると
      // 実行結果・費用を偽装できてしまうため拒否する。更新はWorkerプロセスのみが行う。
      if (current[0].source === 'runtime') {
        throw Object.assign(new Error('Runtime管理のTaskはこのAPIから直接更新できません'), { status: 409 });
      }
      if (current[0].status === 'blocked' && status === 'running') {
        throw Object.assign(new Error('承認待ちのTaskはRetryできません'), { status: 409 });
      }

      const fields = [];
      const values = [];
      let i = 1;
      if (status !== undefined) { fields.push(`status = $${i++}`); values.push(status); }
      if (errorMessage !== undefined) { fields.push(`error_message = $${i++}`); values.push(errorMessage); }
      if (tokensIn !== undefined) { fields.push(`tokens_in = $${i++}`); values.push(tokensIn); }
      if (tokensOut !== undefined) { fields.push(`tokens_out = $${i++}`); values.push(tokensOut); }
      if (cost !== undefined) { fields.push(`cost = $${i++}`); values.push(cost); }
      if (latencyMs !== undefined) { fields.push(`latency_ms = $${i++}`); values.push(latencyMs); }
      if (fields.length === 0) throw Object.assign(new Error('更新項目がありません'), { status: 400 });
      values.push(id);

      const { rows } = await client.query(
        `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, task_code, status`,
        values,
      );
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: `task.${status || 'update'}`, resourceType: 'task', resourceId: id, detail: { status },
      });
      return rows[0];
    });
    res.json({ task: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
