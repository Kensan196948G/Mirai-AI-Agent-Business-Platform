/**
 * AI相談（Chat）向けの実LLM接続（DeepSeek）。
 *
 * LLM_PROVIDER / LLM_API_KEY が未設定の場合は isConfigured() が false を返し、
 * 呼び出し側（routes/chat.js）は必ず chatScenarios.js のルールベース応答へ
 * フォールバックする。実運用でAPIキーを設定するまでは、これまでの挙動から
 * 一切変わらない。
 *
 * コストは DeepSeek のトークン単価（環境変数で上書き可能。既定値は目安であり、
 * 実際の請求額は https://platform.deepseek.com/api-docs/pricing を都度確認すること）
 * から概算し、chat_messages.cost へ記録する。月次ソフトキャップを超えたら
 * isConfigured() は変えず、withinMonthlyBudget() が false を返すことで
 * 呼び出し側がルールベース応答へ自動フォールバックする。
 */

const PROVIDER = process.env.LLM_PROVIDER || '';
const API_KEY = process.env.LLM_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const MONTHLY_CAP_USD = Number(process.env.LLM_MONTHLY_CAP_USD || '5');
const PRICE_INPUT_PER_1M = Number(process.env.LLM_PRICE_INPUT_PER_1M || '0.27');
const PRICE_OUTPUT_PER_1M = Number(process.env.LLM_PRICE_OUTPUT_PER_1M || '1.10');
const MAX_TOKENS = 600;
const TIMEOUT_MS = 15000;
const ENDPOINT = 'https://api.deepseek.com/chat/completions';

const SYSTEM_PROMPT =
  'あなたはMirai AgentOSのAI相談窓口です。建設・土木DXの現場担当者からの相談に、' +
  '簡潔な日本語で応答してください。相談内容を1〜3個の確認質問で深掘りし、' +
  '具体的な業務改善につながる示唆を返してください。長い前置きは不要です。';

export function isConfigured() {
  return PROVIDER === 'deepseek' && API_KEY.length > 0;
}

export function estimateCost(tokensIn, tokensOut) {
  return (tokensIn / 1e6) * PRICE_INPUT_PER_1M + (tokensOut / 1e6) * PRICE_OUTPUT_PER_1M;
}

/** 当月（UTC基準ではなくDBサーバのタイムゾーンに準拠）のLLM利用コスト合計。 */
export async function currentMonthSpend(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(cost), 0)::float AS spent
     FROM chat_messages
     WHERE provider IS NOT NULL AND created_at >= date_trunc('month', now())`,
  );
  return rows[0].spent;
}

export async function withinMonthlyBudget(client) {
  const spent = await currentMonthSpend(client);
  return spent < MONTHLY_CAP_USD;
}

export function monthlyCapUsd() {
  return MONTHLY_CAP_USD;
}

/**
 * DeepSeek Chat Completions API を呼び出す。
 * messages: [{role: 'user'|'assistant', content: string}, ...]（会話履歴、古い順）
 * 失敗時は例外を投げる（呼び出し側でフォールバックすること）。
 */
export async function complete(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek API: 応答本文が空です');
    const tokensIn = data.usage?.prompt_tokens ?? 0;
    const tokensOut = data.usage?.completion_tokens ?? 0;
    return { text, tokensIn, tokensOut, cost: estimateCost(tokensIn, tokensOut), provider: 'deepseek', model: MODEL };
  } finally {
    clearTimeout(timer);
  }
}
