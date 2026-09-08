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

test('isConfigured: provider が deepseek 以外なら false', async () => {
  const llm = await loadLlm({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-test' });
  assert.equal(llm.isConfigured(), false);
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
