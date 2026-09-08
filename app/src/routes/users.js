import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../lib/audit.js';
import { hashPassword, generateInitialPassword } from '../lib/auth.js';

const router = express.Router();

const ROLES = ['Administrator', 'Developer', 'Reviewer', 'Approver', 'Knowledge Curator', 'Viewer'];

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await getPool().query(
    `SELECT id, email, name, dept, role, active, last_login_at FROM users ORDER BY active DESC, name`,
  );
  res.json({ users: rows });
});

// Administrator が新規ユーザーを作成する。初期パスワードはこの応答でのみ一度だけ返す
// （seed-admin.mjs のCLI版と同じ「一度きり表示」方針。ログ・監査ログには残さない）。
router.post('/', requireAuth, requireRole('Administrator'), async (req, res) => {
  const { email, name, role, dept } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'email, name は必須' });
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: '不正な role' });

  const initialPassword = generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, name, role, dept, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, dept, active`,
        [email, name, role || 'Viewer', dept || '', passwordHash],
      );
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'user.create', resourceType: 'user', resourceId: rows[0].id,
        detail: { email, role: rows[0].role },
      });
      return rows[0];
    });
    res.status(201).json({ user: result, initialPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /:id と DELETE /:id（論理削除＝active:false）で共有する更新処理。 */
async function applyUserUpdate(req, res, patch) {
  const id = Number(req.params.id);
  const { role, dept, name, email, active } = patch;
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: '不正な role' });

  const fields = [];
  const values = [];
  let i = 1;
  if (role !== undefined) { fields.push(`role = $${i++}`); values.push(role); }
  if (dept !== undefined) { fields.push(`dept = $${i++}`); values.push(dept); }
  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (email !== undefined) { fields.push(`email = $${i++}`); values.push(email); }
  if (active !== undefined) { fields.push(`active = $${i++}`); values.push(!!active); }
  if (fields.length === 0) return res.status(400).json({ error: '更新項目がありません' });

  // active を無効化する更新は、既存セッションを即時失効させるため token_version も進める。
  if (active === false) fields.push('token_version = token_version + 1');

  values.push(id);
  try {
    const result = await withTransaction(async (client) => {
      // BIGINT列はpgドライバがstringで返すため、比較の前に必ずNumberへ揃える。
      if (active === false && id === Number(req.user.id)) {
        throw Object.assign(new Error('自分自身を無効化することはできません'), { status: 400 });
      }
      if (active === false || (role !== undefined && role !== 'Administrator')) {
        // 無効化・降格で最後の有効な Administrator がいなくなる操作を防ぐ。
        const { rows: admins } = await client.query(
          `SELECT id FROM users WHERE role = 'Administrator' AND active = true`,
        );
        const targetIsOnlyAdmin = admins.length === 1 && Number(admins[0].id) === id;
        if (targetIsOnlyAdmin) {
          throw Object.assign(new Error('最後の Administrator を無効化・降格することはできません'), { status: 400 });
        }
      }

      const { rows } = await client.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, email, name, role, dept, active`,
        values,
      );
      if (rows.length === 0) throw Object.assign(new Error('user が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: active === false ? 'user.deactivate' : 'user.update',
        resourceType: 'user', resourceId: id, detail: { role, dept, name, email, active },
      });
      return rows[0];
    });
    res.json({ user: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

router.patch('/:id', requireAuth, requireRole('Administrator'), (req, res) => applyUserUpdate(req, res, req.body || {}));

// 論理削除（無効化）。projects.owner_id / tasks.created_by 等の参照整合性を壊さないため
// 物理削除は行わない。実体は PATCH { active: false } と同じ処理を共有する。
router.delete('/:id', requireAuth, requireRole('Administrator'), (req, res) => applyUserUpdate(req, res, { active: false }));

// Administrator がユーザーの初期パスワードを再発行する（本人がパスワードを忘れた場合等）。
router.post('/:id/reset-password', requireAuth, requireRole('Administrator'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '不正な id' });

  const newPassword = generateInitialPassword();
  const passwordHash = await hashPassword(newPassword);

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name`,
        [passwordHash, id],
      );
      if (rows.length === 0) throw Object.assign(new Error('user が見つかりません'), { status: 404 });
      await recordAudit(client, {
        actorId: req.user.id, actorType: 'user', actorName: req.user.name,
        action: 'user.reset_password', resourceType: 'user', resourceId: id, detail: {},
      });
      return rows[0];
    });
    res.json({ user: result, newPassword });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
