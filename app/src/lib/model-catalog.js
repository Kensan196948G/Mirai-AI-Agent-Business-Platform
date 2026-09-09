/**
 * Model Router（model_router テーブル: category → モデル名）と実 Provider の対応（C-19）。
 *
 * model_router の「モデル名」は画面上のラベル（例: DeepSeek-V3 / Claude Opus）で、ここで Provider と
 * モデル ID に解決する。API から呼べないラベル（Claude Code / DeepSeek Harness）や、API キー未設定の
 * Provider が選ばれている場合は既定 Provider へフォールバックし、その理由を返す（run_events に記録される）。
 */
import * as llm from './llm.js';

export const DEFAULT_CATEGORY = 'Research / Classification';

/** 画面ラベル → Provider / モデル ID。モデル ID は環境変数で上書きできる。 */
export const MODEL_CATALOG = {
  'DeepSeek-V3': { provider: 'deepseek', model: () => process.env.LLM_DEEPSEEK_MODEL || llm.modelFor('deepseek') || 'deepseek-chat' },
  'Claude Opus': { provider: 'anthropic', model: () => process.env.LLM_ANTHROPIC_MODEL_OPUS || 'claude-opus-5' },
  'Claude Sonnet': { provider: 'anthropic', model: () => process.env.LLM_ANTHROPIC_MODEL_SONNET || llm.modelFor('anthropic') || 'claude-sonnet-5' },
  Codex: { provider: 'openai', model: () => process.env.LLM_OPENAI_MODEL || llm.modelFor('openai') || 'gpt-4o-mini' },
  // 対話型の開発ツール。API から直接は呼べないため既定 Provider へフォールバックする
  'Claude Code': { provider: null, model: () => null, reason: 'Claude Code は API から直接呼べないツールです' },
  'DeepSeek Harness': { provider: null, model: () => null, reason: 'DeepSeek Harness は実行基盤の名称で、単体の API モデルではありません' },
};

/** ラベルを Provider / モデル ID に解決する（設定状況は見ない）。 */
export function catalogEntry(label) {
  const e = MODEL_CATALOG[label];
  if (!e) return { provider: null, model: null, reason: `未知のモデル名です: ${label}` };
  return { provider: e.provider, model: e.model(), reason: e.reason || null };
}

/**
 * category に対して実際に使う Provider / モデルを決める。
 * 戻り値: { category, label, provider, model, configured, fallback_reason }
 *   provider が null の場合は、どの Provider も使えない（呼び出し側が「LLM未設定」として扱う）。
 */
export async function resolveModelForCategory(client, category = DEFAULT_CATEGORY) {
  const { rows } = await client.query(`SELECT model FROM model_router WHERE category = $1`, [category]);
  const label = rows[0]?.model || null;
  const fallback = (reason) => {
    const dp = llm.defaultProvider();
    if (dp && llm.isConfigured(dp)) return { category, label, provider: dp, model: llm.modelFor(dp), configured: true, fallback_reason: reason };
    return { category, label, provider: null, model: null, configured: false, fallback_reason: `${reason}。既定 Provider も未設定です` };
  };
  if (!label) return fallback(`Model Router に category「${category}」がありません`);
  const entry = catalogEntry(label);
  if (!entry.provider) return fallback(entry.reason);
  if (!llm.isConfigured(entry.provider)) return fallback(`${label}（${entry.provider}）の API キーが未設定です`);
  return { category, label, provider: entry.provider, model: entry.model, configured: true, fallback_reason: null };
}

/** /api/router 表示用: 各 category の解決結果（秘密を含まない）。 */
export async function describeRouter(client) {
  const { rows } = await client.query(`SELECT category, model, sort_order FROM model_router ORDER BY sort_order`);
  const out = [];
  for (const r of rows) {
    const resolved = await resolveModelForCategory(client, r.category);
    out.push({ ...r, resolved: { provider: resolved.provider, model: resolved.model, configured: resolved.configured, fallback_reason: resolved.fallback_reason } });
  }
  return out;
}
