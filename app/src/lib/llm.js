/**
 * LLM 接続（複数 Provider 対応、C-19）。AI相談（Chat）と業務Agent の構造化出力が共用する。
 *
 * Provider: deepseek（既定）/ openai / anthropic。
 *   - 既定 Provider は LLM_PROVIDER / LLM_API_KEY / LLM_MODEL（従来どおり。未設定なら isConfigured() は false で、
 *     Chat はルールベース応答へフォールバックし、業務Agent は「LLM未設定」で明示的に失敗する）
 *   - 追加 Provider は LLM_<PROVIDER>_API_KEY / LLM_<PROVIDER>_MODEL / LLM_<PROVIDER>_PRICE_INPUT_PER_1M /
 *     LLM_<PROVIDER>_PRICE_OUTPUT_PER_1M（例: LLM_ANTHROPIC_API_KEY）
 *   - どの Provider を使うかは Model Router（model_router テーブル × lib/model-catalog.js）が Skill の
 *     model_category から決め、Provider が未設定なら既定 Provider へフォールバックする（理由は run_events に残る）
 *
 * コストは各 Provider のトークン単価（環境変数で上書き可能。既定値は目安であり、実際の請求額は各社の
 * 料金ページを都度確認すること）から概算する。月次ソフトキャップは全 Provider 合算で適用する。
 */

const DEFAULT_PROVIDER = process.env.LLM_PROVIDER || '';
const MONTHLY_CAP_USD = Number(process.env.LLM_MONTHLY_CAP_USD || '5');
const MAX_TOKENS = 600;                       // AI相談（短い会話応答）の既定
const STRUCTURED_MAX_TOKENS = Number(process.env.LLM_STRUCTURED_MAX_TOKENS || '4000'); // 業務Agent の構造化出力（JSON）用
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || '60000');

const PROVIDER_DEFAULTS = {
  deepseek: { style: 'openai', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', priceIn: 0.27, priceOut: 1.10 },
  openai: { style: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', priceIn: 0.15, priceOut: 0.60 },
  anthropic: { style: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-5', priceIn: 3.00, priceOut: 15.00 },
};

function envFor(provider, key) {
  return process.env[`LLM_${provider.toUpperCase()}_${key}`];
}

/** 環境変数から各 Provider の設定を組み立てる（モジュール読み込み時に固定）。 */
function buildConfig() {
  const cfg = {};
  for (const [name, d] of Object.entries(PROVIDER_DEFAULTS)) {
    const isDefault = name === DEFAULT_PROVIDER;
    // 従来の LLM_MODEL / LLM_PRICE_* は既定 Provider（未指定なら deepseek）に適用する（後方互換）
    const legacy = isDefault || (DEFAULT_PROVIDER === '' && name === 'deepseek');
    const apiKey = envFor(name, 'API_KEY') || (isDefault ? process.env.LLM_API_KEY || '' : '');
    const model = envFor(name, 'MODEL') || (legacy && process.env.LLM_MODEL) || d.model;
    const priceIn = Number(envFor(name, 'PRICE_INPUT_PER_1M') || (legacy && process.env.LLM_PRICE_INPUT_PER_1M) || d.priceIn);
    const priceOut = Number(envFor(name, 'PRICE_OUTPUT_PER_1M') || (legacy && process.env.LLM_PRICE_OUTPUT_PER_1M) || d.priceOut);
    cfg[name] = { name, style: d.style, endpoint: d.endpoint, apiKey, model, priceIn, priceOut, configured: apiKey.length > 0 };
  }
  return cfg;
}
const CONFIG = buildConfig();

const SYSTEM_PROMPT =
  'あなたはMirai AgentOSのAI相談窓口です。建設・土木DXの現場担当者からの相談に、' +
  '簡潔な日本語で応答してください。相談内容を1〜3個の確認質問で深掘りし、' +
  '具体的な業務改善につながる示唆を返してください。長い前置きは不要です。';

export function defaultProvider() {
  return DEFAULT_PROVIDER;
}

/** 既定 Provider（引数省略時）または指定 Provider が使えるか。 */
export function isConfigured(provider = DEFAULT_PROVIDER) {
  return Boolean(CONFIG[provider]?.configured);
}

export function configuredProviders() {
  return Object.values(CONFIG).filter((c) => c.configured).map((c) => c.name);
}

/** 秘密を含まない Provider 情報（画面・API 表示用）。 */
export function providerInfo() {
  return Object.values(CONFIG).map((c) => ({ provider: c.name, model: c.model, configured: c.configured, is_default: c.name === DEFAULT_PROVIDER }));
}

export function modelFor(provider = DEFAULT_PROVIDER) {
  return CONFIG[provider]?.model || null;
}

export function estimateCost(tokensIn, tokensOut, provider = DEFAULT_PROVIDER) {
  const c = CONFIG[provider] || CONFIG.deepseek;
  return (tokensIn / 1e6) * c.priceIn + (tokensOut / 1e6) * c.priceOut;
}

/**
 * 当月（DBサーバのタイムゾーンに準拠）のLLM利用コスト合計。
 * AI相談（chat_messages.cost）と業務Agent Run（budget_reservations.spent_usd）の両方を合算する。
 * 月次ソフトキャップは両者・全 Provider に共通で適用される（Chat はルールベースへフォールバック、
 * Run は予算超過として Step を保留する）。
 */
export async function currentMonthSpend(client) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(cost), 0) FROM chat_messages
         WHERE provider IS NOT NULL AND created_at >= date_trunc('month', now()))
     + (SELECT COALESCE(SUM(spent_usd), 0) FROM budget_reservations
         WHERE created_at >= date_trunc('month', now()))
     AS spent`,
  );
  return Number(rows[0].spent);
}

export async function withinMonthlyBudget(client) {
  const spent = await currentMonthSpend(client);
  return spent < MONTHLY_CAP_USD;
}

export function monthlyCapUsd() {
  return MONTHLY_CAP_USD;
}

export function structuredMaxTokens() {
  return STRUCTURED_MAX_TOKENS;
}

/**
 * LLM を呼び出す。
 * messages: [{role: 'user'|'assistant', content: string}, ...]（会話履歴、古い順）
 * options.provider / options.model: 省略時は既定 Provider とそのモデル
 * options.maxTokens: 出力上限（既定 600。構造化出力は structuredMaxTokens() を使う）
 * options.jsonMode: OpenAI 互換 API では response_format=json_object（プロンプトに "JSON" を含めること）。
 *                   Anthropic は JSON モードが無いためプロンプトの指示に依存する
 * options.systemPrompt: 省略時は AI相談用の SYSTEM_PROMPT
 * 戻り値: { text, tokensIn, tokensOut, cost, provider, model, finishReason }（'length' なら打ち切り）
 * 失敗時は例外を投げる（呼び出し側でフォールバックすること）。
 */
export async function complete(messages, { provider = DEFAULT_PROVIDER, model, maxTokens = MAX_TOKENS, jsonMode = false, systemPrompt = SYSTEM_PROMPT } = {}) {
  const c = CONFIG[provider];
  if (!c) throw new Error(`未対応の LLM Provider です: ${provider}`);
  if (!c.configured) throw new Error(`LLM Provider ${provider} の API キーが未設定です`);
  const useModel = model || c.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const req = c.style === 'anthropic'
      ? {
          headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
          body: { model: useModel, max_tokens: maxTokens, temperature: 0.4, system: systemPrompt, messages },
        }
      : {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
          body: {
            model: useModel, messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: maxTokens, temperature: 0.4,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          },
        };
    const res = await fetch(c.endpoint, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${provider} API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    let text, tokensIn, tokensOut, finishReason;
    if (c.style === 'anthropic') {
      text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      tokensIn = data.usage?.input_tokens ?? 0;
      tokensOut = data.usage?.output_tokens ?? 0;
      finishReason = data.stop_reason === 'max_tokens' ? 'length' : (data.stop_reason || null);
    } else {
      text = data.choices?.[0]?.message?.content?.trim();
      tokensIn = data.usage?.prompt_tokens ?? 0;
      tokensOut = data.usage?.completion_tokens ?? 0;
      finishReason = data.choices?.[0]?.finish_reason || null;
    }
    if (!text) throw new Error(`${provider} API: 応答本文が空です`);
    return { text, tokensIn, tokensOut, cost: estimateCost(tokensIn, tokensOut, provider), provider, model: useModel, finishReason };
  } finally {
    clearTimeout(timer);
  }
}
