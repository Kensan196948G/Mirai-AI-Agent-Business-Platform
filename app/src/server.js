import express from 'express';
import { PORT, PUBLIC_DIR } from './lib/config.js';
import { getPool } from './lib/db.js';
import { collectHealth, evaluateHealth } from './lib/health.js';
import { csrfGuard } from './middleware/csrf.js';

import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import projectRoutes from './routes/projects.js';
import approvalRoutes from './routes/approvals.js';
import taskRoutes from './routes/tasks.js';
import knowledgeRoutes from './routes/knowledge.js';
import auditLogRoutes from './routes/audit-log.js';
import userRoutes from './routes/users.js';
import platformRoutes from './routes/platform.js';
import dashboardRoutes from './routes/dashboard.js';
import chatRoutes from './routes/chat.js';
import agentRunRoutes from './routes/agent-runs.js';
import artifactRoutes from './routes/artifacts.js';
import skillVersionRoutes from './routes/skill-versions.js';
import agentCatalogRoutes from './routes/agent-catalog.js';
import sourceRoutes from './routes/sources.js';

const app = express();
app.disable('x-powered-by');
app.use('/api', csrfGuard); // 更新系 API の Origin 検証（F-31）
app.use(express.json({ limit: '64kb' }));
app.use(express.static(PUBLIC_DIR));

// status は API プロセス自身の生存（従来どおり常に ok）。worker/queue/runs は Agent Runtime の稼働状況で、
// 問題があれば degraded に理由を列挙する（API 自体は 200 を返す。監視は degraded を見る）。
app.get('/api/health', async (_req, res) => {
  try {
    const h = await collectHealth(getPool());
    const degraded = evaluateHealth(h);
    res.json({ status: 'ok', ...h, degraded });
  } catch (err) {
    res.json({ status: 'ok', worker: null, queue: null, runs: null, degraded: [`health集計エラー: ${err.message}`] });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/audit', auditLogRoutes);
app.use('/api/users', userRoutes);
app.use('/api', platformRoutes); // /api/integrations, /api/agents, /api/skills, /api/router, /api/usage
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/agent-runs', agentRunRoutes);
app.use('/api/artifacts', artifactRoutes);
app.use('/api/skills', skillVersionRoutes); // /api/skills/:id/versions（platformRoutesのGET /skillsとはパスが異なり衝突しない）
app.use('/api/agent-catalog', agentCatalogRoutes);
app.use('/api/sources', sourceRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Mirai AgentOS listening on 127.0.0.1:${PORT}`);
  });
}

export { app };
