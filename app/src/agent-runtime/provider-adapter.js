/**
 * 業務Agent Runtime用のProvider Adapter。Chat向け lib/llm.js の DeepSeek接続をそのまま再利用し、
 * 構造化出力（JSON Schema検証）とRun予算への計上を追加する。
 *
 * 「未接続を偽の成功で埋めない」: LLM_PROVIDER/LLM_API_KEY が未設定の場合は明確なエラーを投げる
 * （Chat機能のようなルールベースへの意味的フォールバックは、業務判断が必要な構造化出力には無いため）。
 * JSON Schema検証に失敗した場合は、最大1回リトライしたうえで、それでも失敗すれば
 * 「根拠なし・要人手確認」の安全な既定値へ縮退する（これは成功を装うものではなく、
 * on_missing_evidence: abstain の具体化である）。
 */
import Ajv from 'ajv';
import * as llm from '../lib/llm.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export class ProviderNotConfiguredError extends Error {}

export function isConfigured() {
  return llm.isConfigured();
}

/**
 * JSON Schemaに適合する構造化出力を1回のLLM呼び出しで得る。
 * messages: [{role:'user'|'assistant', content:string}]
 * 戻り値: { data, tokensIn, tokensOut, cost, degraded }
 *   degraded=true の場合、LLM出力の検証に失敗し fallbackData を使ったことを示す。
 */
export async function structuredComplete({ instructions, input, schema, fallbackData, maxAttempts = 2 }) {
  if (!isConfigured()) {
    throw new ProviderNotConfiguredError('LLM_PROVIDER/LLM_API_KEY が未設定のため実行できません');
  }
  const validate = ajv.compile(schema);
  const basePrompt =
    `${instructions}\n\n入力:\n${JSON.stringify(input)}\n\n` +
    `出力は次のJSON Schemaに厳密に適合するJSONのみを返してください（説明文・コードフェンス不要）:\n` +
    `${JSON.stringify(schema)}`;

  let lastError = null;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const messages = attempt === 1
      ? [{ role: 'user', content: basePrompt }]
      : [
          { role: 'user', content: basePrompt },
          { role: 'assistant', content: lastError.rawText || '' },
          { role: 'user', content: `前回の出力はJSON Schemaに適合しませんでした（${lastError.message}）。JSONのみで出力し直してください。` },
        ];

    let completion;
    try {
      completion = await llm.complete(messages);
    } catch (err) {
      lastError = { message: err.message, rawText: '' };
      continue;
    }
    totalTokensIn += completion.tokensIn;
    totalTokensOut += completion.tokensOut;
    totalCost += completion.cost;

    let parsed;
    try {
      const jsonText = extractJson(completion.text);
      parsed = JSON.parse(jsonText);
    } catch (err) {
      lastError = { message: `JSON解析に失敗: ${err.message}`, rawText: completion.text };
      continue;
    }
    if (!validate(parsed)) {
      lastError = { message: ajv.errorsText(validate.errors), rawText: completion.text };
      continue;
    }
    return { data: parsed, tokensIn: totalTokensIn, tokensOut: totalTokensOut, cost: totalCost, degraded: false };
  }

  // maxAttempts回失敗 → 「根拠なし・要人手確認」の安全な既定値へ縮退する（偽の成功ではなく明示的な保留）。
  return { data: fallbackData, tokensIn: totalTokensIn, tokensOut: totalTokensOut, cost: totalCost, degraded: true };
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}
