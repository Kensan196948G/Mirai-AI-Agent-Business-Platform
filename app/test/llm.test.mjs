import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = pathToFileURL(join(__dirname, '..', 'src', 'lib', 'llm.js')).href;

// llm.js は環境変数をモジュール読み込み時に定数へ束縛するため、設定を変えてテストする場合は
// クエリを変えて再インポートし、モジュールキャッシュを回避する。
async function loadLlm(env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    return await import(`${MODULE_PATH}?v=${Math.random()}`);
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('isConfigured: LLM_PROVIDER/LLM_API_KEY が未設定なら false', async () => {
  const llm = await loadLlm({ LLM_PROVIDER: '', LLM_API_KEY: '' });
  assert.equal(llm.isConfigured(), false);
});

test('isConfigured: deepseek + API_KEY があれば true', async () => {
  const llm = await loadLlm({ LLM_PROVIDER: 'deepseek', LLM_API_KEY: 'sk-test' });
  assert.equal(llm.isConfigured(), true);
});

test('isConfigured: 未対応 provider は false、openai / anthropic は API キーがあれば true。追加 Provider は個別の環境変数で有効化', async () => {
  const bad = await loadLlm({ LLM_PROVIDER: 'foo', LLM_API_KEY: 'sk-test' });
  assert.equal(bad.isConfigured(), false);
  const oa = await loadLlm({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-test' });
  assert.equal(oa.isConfigured(), true);
  const multi = await loadLlm({ LLM_PROVIDER: 'deepseek', LLM_API_KEY: 'sk-test', LLM_ANTHROPIC_API_KEY: 'ak-test', LLM_OPENAI_API_KEY: '' });
  assert.deepEqual(multi.configuredProviders(), ['deepseek', 'anthropic']);
  assert.equal(multi.isConfigured('anthropic'), true);
  assert.equal(multi.isConfigured('openai'), false);
  assert.deepEqual(multi.providerInfo().map((p) => [p.provider, p.configured, p.is_default]), [['deepseek', true, true], ['openai', false, false], ['anthropic', true, false]]);
  assert.ok(!JSON.stringify(multi.providerInfo()).includes('sk-test'), 'providerInfo に秘密を含めない');
});

test('estimateCost: 既定単価でトークン数からコストを概算する', async () => {
  const llm = await loadLlm({
    LLM_PRICE_INPUT_PER_1M: '1', LLM_PRICE_OUTPUT_PER_1M: '2',
    LLM_PROVIDER: '', LLM_API_KEY: '',
  });
  // 入力100万トークン=$1, 出力50万トークン=$1 → 合計$2
  assert.equal(llm.estimateCost(1_000_000, 500_000), 2);
});

test('monthlyCapUsd: 環境変数を数値として反映する', async () => {
  const llm = await loadLlm({ LLM_MONTHLY_CAP_USD: '12.5' });
  assert.equal(llm.monthlyCapUsd(), 12.5);
});

test('currentMonthSpend: client.query の結果をそのまま返す（::float キャスト済み想定）', async () => {
  const llm = await loadLlm({});
  // SQL側で ::float にキャストしているため pg は number を返す（numeric とは異なり string 化しない）。
  const fakeClient = { query: async () => ({ rows: [{ spent: 3.45 }] }) };
  const spent = await llm.currentMonthSpend(fakeClient);
  assert.equal(spent, 3.45);
});

test('withinMonthlyBudget: 当月コストが上限未満なら true', async () => {
  const llm = await loadLlm({ LLM_MONTHLY_CAP_USD: '5' });
  const fakeClient = { query: async () => ({ rows: [{ spent: 4.99 }] }) };
  assert.equal(await llm.withinMonthlyBudget(fakeClient), true);
});

test('withinMonthlyBudget: 当月コストが上限以上なら false', async () => {
  const llm = await loadLlm({ LLM_MONTHLY_CAP_USD: '5' });
  const fakeClient = { query: async () => ({ rows: [{ spent: 5 }] }) };
  assert.equal(await llm.withinMonthlyBudget(fakeClient), false);
});

test('complete: 構造化出力向けオプション（maxTokens / jsonMode / systemPrompt）を API リクエストへ反映し、finish_reason を返す', async () => {
  const llm = await loadLlm({ LLM_PROVIDER: 'deepseek', LLM_API_KEY: 'sk-test', LLM_STRUCTURED_MAX_TOKENS: '4321' });
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  try {
    const r = await llm.complete([{ role: 'user', content: 'JSON で' }], { maxTokens: llm.structuredMaxTokens(), jsonMode: true, systemPrompt: 'SYS' });
    assert.equal(calls[0].max_tokens, 4321);
    assert.deepEqual(calls[0].response_format, { type: 'json_object' });
    assert.equal(calls[0].messages[0].content, 'SYS');
    assert.equal(r.finishReason, 'length');
    const chat = await llm.complete([{ role: 'user', content: 'こんにちは' }]);
    assert.equal(calls[1].max_tokens, 600);
    assert.equal(calls[1].response_format, undefined);
    assert.equal(chat.finishReason, 'length');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('complete: Provider ごとに API 形式が異なる（OpenAI 互換は chat/completions、Anthropic は messages）', async () => {
  const llm = await loadLlm({ LLM_PROVIDER: 'deepseek', LLM_API_KEY: 'sk-ds', LLM_ANTHROPIC_API_KEY: 'ak-an', LLM_OPENAI_API_KEY: 'sk-oa', LLM_ANTHROPIC_PRICE_INPUT_PER_1M: '3', LLM_ANTHROPIC_PRICE_OUTPUT_PER_1M: '15' });
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
    if (url.includes('anthropic')) return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 1000000, output_tokens: 100000 }, stop_reason: 'max_tokens' }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  try {
    const an = await llm.complete([{ role: 'user', content: 'JSON で' }], { provider: 'anthropic', model: 'claude-test', jsonMode: true, systemPrompt: 'SYS', maxTokens: 123 });
    assert.ok(calls[0].url.includes('api.anthropic.com/v1/messages'));
    assert.equal(calls[0].headers['x-api-key'], 'ak-an');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(calls[0].body.system, 'SYS');
    assert.equal(calls[0].body.max_tokens, 123);
    assert.equal(calls[0].body.response_format, undefined, 'Anthropic に response_format は送らない');
    assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'JSON で' }]);
    assert.equal(an.provider, 'anthropic'); assert.equal(an.model, 'claude-test'); assert.equal(an.finishReason, 'length');
    assert.equal(an.cost, 3 + 1.5, 'Provider ごとの単価で概算');
    const oa = await llm.complete([{ role: 'user', content: 'hi' }], { provider: 'openai' });
    assert.ok(calls[1].url.includes('api.openai.com'));
    assert.equal(calls[1].headers.Authorization, 'Bearer sk-oa');
    assert.equal(calls[1].body.model, 'gpt-4o-mini');
    assert.equal(oa.provider, 'openai');
    const ds = await llm.complete([{ role: 'user', content: 'hi' }]);
    assert.ok(calls[2].url.includes('api.deepseek.com'));
    assert.equal(ds.provider, 'deepseek');
    await assert.rejects(llm.complete([{ role: 'user', content: 'x' }], { provider: 'foo' }), /未対応/);
  } finally { globalThis.fetch = savedFetch; }
});
