import express from 'express';
import { getPool, withTransaction } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { matchScenario } from '../lib/chatScenarios.js';
import { structureIdea } from '../lib/chat-idea.js';
import * as llm from '../lib/llm.js';

const router = express.Router();

const GREETING =
  'こんにちは。Mirai AgentOSです。困りごと・改善したい業務・研究テーマを普段の言葉で教えてください。' +
  'Intentを分類し、Notionの既存Knowledgeを参照して案件化まで整理します。';

const HISTORY_LIMIT = 8;

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

function withSource(row) {
  return { ...row, source: row.provider ? 'llm' : 'scripted' };
}

router.get('/conversations/me', requireAuth, async (req, res) => {
  const conversationId = await withTransaction((client) => getOrCreateConversation(client, req.user.id));
  const { rows } = await getPool().query(
    `SELECT role, text, idea_json, provider, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY id ASC`,
    [conversationId],
  );
  res.json({ conversationId, messages: rows.map(withSource) });
});

// 「新しい相談」— 常に新規の会話を開始する（既存の会話は履歴として残る）。
router.post('/conversations', requireAuth, async (req, res) => {
  const result = await withTransaction(async (client) => {
    const created = await client.query(`INSERT INTO chat_conversations (user_id) VALUES ($1) RETURNING id`, [req.user.id]);
    await client.query(`INSERT INTO chat_messages (conversation_id, role, text) VALUES ($1, 'ai', $2)`, [created.rows[0].id, GREETING]);
    return created.rows[0].id;
  });
  const { rows } = await getPool().query(
    `SELECT role, text, idea_json, provider, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY id ASC`,
    [result],
  );
  res.status(201).json({ conversationId: result, messages: rows.map(withSource) });
});

router.post('/messages', requireAuth, async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text は必須' });

  const result = await withTransaction(async (client) => {
    const conversationId = await getOrCreateConversation(client, req.user.id);

    const scenario = matchScenario(text);

    const { rows: history } = await client.query(
      `SELECT role, text FROM chat_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
      [conversationId, HISTORY_LIMIT],
    );

    // IDEA 構造化: LLM が使えれば相談文・履歴・Agent カタログから抽出（schema 検証・Injection 対策・費用計上つき）。
    // 使えない / 失敗した場合はルールベース（シナリオ + 語の一致）へ戻し、idea_json.source で区別する。
    const llmAllowed = llm.isConfigured() && (await llm.withinMonthlyBudget(client));
    const structured = await structureIdea({ text, history: history.slice().reverse(), llmAllowed });
    const ideaJson = structured.idea;

    await client.query(
      `INSERT INTO chat_messages (conversation_id, role, text) VALUES ($1, 'user', $2)`,
      [conversationId, text],
    );

    // 応答本文（自然言語のやり取り）のみ、設定されていれば実LLM（DeepSeek）を使う。
    // 未接続・月次予算超過・API失敗のいずれの場合も、必ずルールベース応答へフォールバックする。
    let responseText = scenario.clarify;
    let llmMeta = null;
    if (llm.isConfigured() && (await llm.withinMonthlyBudget(client))) {
      try {
        const messages = history
          .reverse()
          .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
        messages.push({ role: 'user', content: text });
        const completion = await llm.complete(messages);
        responseText = completion.text;
        llmMeta = completion;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('LLM呼び出し失敗、ルールベース応答へフォールバック:', err.message);
      }
    }

    // 費用・トークンは返答本文と IDEA 構造化の合計を記録する（月次上限の集計対象）
    const usedLlm = llmMeta || structured.provider;
    const { rows } = await client.query(
      `INSERT INTO chat_messages (conversation_id, role, text, idea_json, provider, tokens_in, tokens_out, cost)
       VALUES ($1, 'ai', $2, $3, $4, $5, $6, $7)
       RETURNING role, text, idea_json, provider, created_at`,
      [
        conversationId, responseText, ideaJson,
        usedLlm ? (llmMeta?.provider || structured.provider) : null,
        usedLlm ? (llmMeta?.tokensIn ?? 0) + (structured.tokensIn || 0) : null,
        usedLlm ? (llmMeta?.tokensOut ?? 0) + (structured.tokensOut || 0) : null,
        usedLlm ? (llmMeta?.cost ?? 0) + (structured.cost || 0) : null,
      ],
    );
    return rows[0];
  });

  res.status(201).json({ message: withSource(result) });
});

export default router;
