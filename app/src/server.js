import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadEnv } from './lib/env.js';
import { getPool, withTransaction } from './lib/db.js';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  sessionCookie,
  CLEAR_SESSION_COOKIE,
} from './lib/auth.js';
import { nextRequestCode, nextProjectCode } from './lib/codes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '..', '.env'));

const SESSION_SECRET = process.env.SESSION_SECRET;
const PORT = Number(process.env.PORT || 18860);
const isProd = process.env.NODE_ENV === 'production';

if (!SESSION_SECRET || SESSION_SECRET === 'CHANGE_ME') {
  throw new Error('SESSION_SECRET が未設定、または既定値のまま。.env を設定すること');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(join(__dirname, '..', 'public')));

async function audit(client, actorId, action, targetType, targetId, detail = {}) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, targetType, targetId, detail],
  );
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const claims = verifySessionToken(cookies.session, SESSION_SECRET);
  if (!claims) return res.status(401).json({ error: 'ログインが必要です' });
  const { rows } = await getPool().query(
    'SELECT id, email, name, role, token_version FROM users WHERE id = $1',
    [claims.userId],
  );
  // token_version が現在値と一致しないトークンはログアウト済み・失効済みとして拒否する
  if (rows.length === 0 || rows[0].token_version !== claims.tokenVersion) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  req.user = rows[0];
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `権限不足（必要なロール: ${roles.join(' / ')}）` });
    }
    next();
  };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email, password は必須' });

  const { rows } = await getPool().query(
    'SELECT id, password_hash, token_version FROM users WHERE email = $1',
    [email],
  );
  // 存在有無で応答を変えない（ユーザー列挙対策）
  const ok = rows.length > 0 && (await verifyPassword(password, rows[0].password_hash));
  if (!ok) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });

  const token = createSessionToken(rows[0].id, rows[0].token_version, SESSION_SECRET);
  res.setHeader('Set-Cookie', sessionCookie(token, { secure: isProd }));
  res.json({ status: 'ok' });
});

// ステートレストークンは Cookie を消すだけでは失効しないため、token_version をインクリメントして
// 発行済みトークンを全て無効化する（他デバイスのセッションも含めて即時ログアウトになる）。
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await getPool().query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
  res.setHeader('Set-Cookie', CLEAR_SESSION_COOKIE);
  res.json({ status: 'ok' });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.post('/api/requests', requireAuth, async (req, res) => {
  const { title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title, description は必須' });

  const result = await withTransaction(async (client) => {
    const code = await nextRequestCode(client);
    const { rows } = await client.query(
      `INSERT INTO requests (request_code, title, description, requester_id)
       VALUES ($1, $2, $3, $4) RETURNING id, request_code, title, description, status, created_at`,
      [code, title, description, req.user.id],
    );
    await audit(client, req.user.id, 'request.create', 'request', rows[0].id, { code });
    return rows[0];
  });

  res.status(201).json({ request: result });
});

app.get('/api/requests', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT r.id, r.request_code, r.title, r.description, r.status, r.created_at,
            u.name AS requester_name
     FROM requests r JOIN users u ON u.id = r.requester_id
     ORDER BY r.created_at DESC`,
  );
  res.json({ requests: rows });
});

app.post('/api/requests/:id/promote', requireAuth, requireRole('Administrator', 'Developer'), async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId)) return res.status(400).json({ error: '不正な id' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows: reqRows } = await client.query(
        `SELECT id, title, description, status FROM requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (reqRows.length === 0) throw Object.assign(new Error('request が見つかりません'), { status: 404 });
      if (reqRows[0].status !== 'submitted') {
        throw Object.assign(new Error(`昇格できない状態です（現在: ${reqRows[0].status}）`), { status: 409 });
      }

      const projectCode = await nextProjectCode(client);
      const { rows: projRows } = await client.query(
        `INSERT INTO projects (project_code, title, description, request_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, project_code, title, description, status, created_at`,
        [projectCode, reqRows[0].title, reqRows[0].description, requestId, req.user.id],
      );

      const { rows: approvalRows } = await client.query(
        `INSERT INTO approval_requests (project_id, requested_by) VALUES ($1, $2)
         RETURNING id, project_id, status, created_at`,
        [projRows[0].id, req.user.id],
      );

      await client.query(`UPDATE requests SET status = 'promoted' WHERE id = $1`, [requestId]);

      await audit(client, req.user.id, 'request.promote', 'project', projRows[0].id, {
        request_id: requestId,
      });

      return { project: projRows[0], approval_request: approvalRows[0] };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/projects', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, project_code, title, description, status, created_at FROM projects ORDER BY created_at DESC`,
  );
  res.json({ projects: rows });
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });

  const { rows: projRows } = await getPool().query(
    `SELECT id, project_code, title, description, status, created_at FROM projects WHERE id = $1`,
    [id],
  );
  if (projRows.length === 0) return res.status(404).json({ error: 'project が見つかりません' });

  const { rows: approvalRows } = await getPool().query(
    `SELECT ar.id, ar.status, ar.comment, ar.created_at, ar.decided_at, u.name AS decided_by_name
     FROM approval_requests ar LEFT JOIN users u ON u.id = ar.decided_by
     WHERE ar.project_id = $1 ORDER BY ar.created_at DESC`,
    [id],
  );

  res.json({ project: projRows[0], approvals: approvalRows });
});

app.get('/api/approvals', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT ar.id, ar.status, ar.created_at, p.id AS project_id, p.project_code, p.title
     FROM approval_requests ar JOIN projects p ON p.id = ar.project_id
     WHERE ar.status = 'pending' ORDER BY ar.created_at ASC`,
  );
  res.json({ approvals: rows });
});

app.post(
  '/api/approvals/:id/decide',
  requireAuth,
  requireRole('Administrator', 'Approver'),
  async (req, res) => {
    const id = Number(req.params.id);
    const { decision, comment } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision は approved / rejected のいずれか' });
    }

    try {
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, status FROM approval_requests WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (rows.length === 0) throw Object.assign(new Error('approval が見つかりません'), { status: 404 });
        if (rows[0].status !== 'pending') {
          throw Object.assign(new Error(`既に判定済みです（現在: ${rows[0].status}）`), { status: 409 });
        }

        await client.query(
          `UPDATE approval_requests SET status = $1, decided_by = $2, decided_at = now(), comment = $3 WHERE id = $4`,
          [decision, req.user.id, comment || null, id],
        );
        await client.query(`UPDATE projects SET status = $1 WHERE id = $2`, [decision, rows[0].project_id]);

        await audit(client, req.user.id, `approval.${decision}`, 'project', rows[0].project_id, {
          approval_id: id,
          comment: comment || null,
        });

        return { approval_id: id, decision };
      });

      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  },
);

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
