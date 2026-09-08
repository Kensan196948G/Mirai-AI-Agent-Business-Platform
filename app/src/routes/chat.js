import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { matchScenario } from '../lib/chatScenarios.js';

const router = express.Router();

const GREETING =
  'こんにちは。Mirai AgentOSです。困りごと・改善したい業務・研究テーマを普段の言葉で教えてください。' +
  'Intentを分類し、Notionの既存Knowledgeを参照して案件化まで整理します。';

async function getOrCreateConversation(client, userId) {
  const { rows } = await client.query(
    `SELECT id FROM chat_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (rows.length > 0) return rows[0].id;

  const created = await client.query(
    `INSERT INTO chat_conversations (user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  await client.query(
    `INSERT INTO chat_messages (conversation_id, role, text) VALUES ($1, 'ai', $2)`,
    [created.rows[0].id, GREETING],
  );
  return created.rows[0].id;
}

router.get('/conversations/me', requireAuth, async (req, res) => {
  const conversationId = await withTransaction((client) => getOrCreateConversation(client, req.user.id));
  const { rows } = await getPool().query(
    `SELECT role, text, idea_json, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY id ASC`,
    [conversationId],
  );
  res.json({ conversationId, messages: rows });
});

// 「新しい相談」— 常に新規の会話を開始する（既存の会話は履歴として残る）。
router.post('/conversations', requireAuth, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const created = await client.query(`INSERT INTO chat_conversations (user_id) VALUES ($1) RETURNING id`, [req.user.id]);
    await client.query(`INSERT INTO chat_messages (conversation_id, role, text) VALUES ($1, 'ai', $2)`, [created.rows[0].id, GREETING]);
    return created.rows[0].id;
  });
  const { rows } = await getPool().query(
    `SELECT role, text, idea_json, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY id ASC`,
    [result],
  );
  res.status(201).json({ conversationId: result, messages: rows });
});

router.post('/messages', requireAuth, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text は必須' });

  const result = await withTransaction(async (client) => {
    const conversationId = await getOrCreateConversation(client, req.user.id);
    await client.query(
      `INSERT INTO chat_messages (conversation_id, role, text) VALUES ($1, 'user', $2)`,
      [conversationId, text],
    );

    const scenario = matchScenario(text);
    const ideaJson = {
      title: scenario.title,
      intent: scenario.intent,
      risk: scenario.risk,
      idea: scenario.idea,
    };
    const { rows } = await client.query(
      `INSERT INTO chat_messages (conversation_id, role, text, idea_json) VALUES ($1, 'ai', $2, $3)
       RETURNING role, text, idea_json, created_at`,
      [conversationId, scenario.clarify, ideaJson],
    );
    return rows[0];
  });

  res.status(201).json({ message: result });
});

export default router;
