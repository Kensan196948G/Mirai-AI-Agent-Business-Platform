/** Model Router の解決（C-19）。DB は偽クライアントで代替し、LLM は呼ばない。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'deepseek';
process.env.LLM_API_KEY = 'sk-test-dummy'; // doc003-allow: モック用のダミー（外部へ送信しない）
delete process.env.LLM_ANTHROPIC_API_KEY; delete process.env.LLM_OPENAI_API_KEY;
const { catalogEntry, resolveModelForCategory, describeRouter, DEFAULT_CATEGORY } = await import('../src/lib/model-catalog.js');

const fakeClient = (rows) => ({ query: async (sql, params) => ({ rows: /WHERE category/.test(sql) ? rows.filter((r) => r.category === params[0]) : rows }) });

test('catalogEntry: ラベルを Provider / モデル ID に解決し、API から呼べないラベルは理由付きで null', () => {
  assert.deepEqual(catalogEntry('DeepSeek-V3'), { provider: 'deepseek', model: 'deepseek-chat', reason: null });
  assert.equal(catalogEntry('Claude Opus').provider, 'anthropic');
  assert.equal(catalogEntry('Codex').provider, 'openai');
  assert.equal(catalogEntry('Claude Code').provider, null);
  assert.match(catalogEntry('Claude Code').reason, /API から直接呼べない/);
  assert.match(catalogEntry('未知').reason, /未知のモデル名/);
});

test('resolveModelForCategory: 設定済み Provider はそのまま、未設定 Provider・非 API ラベル・未登録 category は既定 Provider へフォールバック', async () => {
  const client = fakeClient([
    { category: DEFAULT_CATEGORY, model: 'DeepSeek-V3', sort_order: 0 },
    { category: 'Architecture / Docs', model: 'Claude Opus', sort_order: 1 },
    { category: 'Repository Development', model: 'Claude Code', sort_order: 2 },
  ]);
  const a = await resolveModelForCategory(client, DEFAULT_CATEGORY);
  assert.deepEqual([a.provider, a.model, a.fallback_reason], ['deepseek', 'deepseek-chat', null]);
  const b = await resolveModelForCategory(client, 'Architecture / Docs');
  assert.equal(b.provider, 'deepseek'); assert.equal(b.label, 'Claude Opus'); assert.match(b.fallback_reason, /API キーが未設定/);
  const c = await resolveModelForCategory(client, 'Repository Development');
  assert.equal(c.provider, 'deepseek'); assert.match(c.fallback_reason, /API から直接呼べない/);
  const d = await resolveModelForCategory(client, 'No Such');
  assert.equal(d.provider, 'deepseek'); assert.match(d.fallback_reason, /がありません/);
  const desc = await describeRouter(client);
  assert.equal(desc.length, 3);
  assert.equal(desc[1].resolved.configured, true);
  assert.ok(!JSON.stringify(desc).includes('sk-test'));
});
