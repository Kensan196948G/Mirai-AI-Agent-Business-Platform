/** AI相談の IDEA 構造化（LLM 版 + ルールベース）と統合カタログのユニットテスト。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUnifiedCatalog, matchByKeywords, validateSuggestions, findAgent } from '../src/agent-runtime/catalog.js';

// llm.js は初回 import 時に環境変数を束縛するため、chat-idea を import する前に設定する（fetch はモックし外部へ出ない）
process.env.LLM_PROVIDER = 'deepseek'; process.env.LLM_API_KEY = 'sk-test-dummy'; // doc003-allow: モック用のダミー

test('統合カタログ: org-map の 9 組織と 30 Agent（P1 22 件は実行可、P2/P3 は候補）が読める', () => {
  const c = loadUnifiedCatalog();
  assert.equal(c.organizations.length, 9);
  assert.equal(c.agents.length, 30);
  const p1 = c.agents.filter((a) => a.stage === 'P1').map((a) => a.agent_id).sort();
  assert.equal(p1.length, 22, 'P1: 元の 3 Agent + 組織責務 Agent 9 種 + 土木専門 Agent 9 種 + 相互レビュー Agent');
  assert.equal(c.agents.filter((a) => a.layer === 'cross_review').length, 1);
  assert.equal(findAgent('cross-review-agent').model_category, 'Independent Review');
  assert.equal(c.agents.filter((a) => a.layer === 'civil_expert').length, 9);
  assert.ok(c.agents.filter((a) => a.layer === 'civil_expert').every((a) => a.executable && /^T[1-6]$/.test(a.technical_risk_class) && a.required_conditions.length >= 2 && a.keywords.length >= 3 && a.org_code === null));
  for (const id of ['knowledge-quality', 'project-case-research', 'technology-selection', 'governance-support', 'external-dx-support']) assert.ok(p1.includes(id));
  const orgs = new Set(c.agents.filter((a) => a.layer === 'organization' && a.org_code && a.executable).map((a) => a.org_code));
  assert.equal(orgs.size, 9, '01〜09 のすべてに実行可能な Agent がある');
  assert.ok(c.agents.filter((a) => a.stage === 'P1').every((a) => a.executable && a.purpose && a.does_not));
  assert.ok(c.agents.filter((a) => a.stage !== 'P1').every((a) => !a.executable && a.backlog_id));
  assert.equal(findAgent('technology-selection').dept, '技術・研究開発');
  assert.equal(findAgent('nope'), null);
});

test('語の一致: 部署が合うだけでは Agent を挙げず、相談文と Agent の説明の両方に現れる語がある場合だけ挙げる', () => {
  const help = matchByKeywords('過去のヘルプデスク状況を参照したい');
  assert.deepEqual(help.departments, ['06']);
  assert.deepEqual(help.agents, [], 'ヘルプデスクに合う Agent は無い');
  const tech = matchByKeywords('軟弱地盤の液状化対策の工法を比較したい');
  assert.ok(tech.agents.some((a) => a.agent_id === 'technology-selection'));
  assert.ok(tech.agents.some((a) => a.agent_id === 'ground-improvement-support'));
  const v = validateSuggestions({ agentIds: ['technology-selection', 'made-up-agent'], departments: ['04', '99'] });
  assert.deepEqual(v, { agentIds: ['technology-selection'], departments: ['04'] });
});

test('ルールベース構造化: 未抽出のプレースホルダーを出さず、該当 Agent が無ければ needs_new_agent=true', async () => {
  const { scriptedIdea } = await import('../src/lib/chat-idea.js');
  const s = scriptedIdea('過去のヘルプデスク状況を参照したい');
  assert.equal(s.source, 'scripted');
  assert.equal(s.needs_new_agent, true);
  assert.equal(s.consultation, '過去のヘルプデスク状況を参照したい');
  assert.ok(!JSON.stringify(s.idea).includes('（相談内容から抽出）'));
  assert.equal(s.idea.find((r) => r[0] === '対象業務')[1], '過去のヘルプデスク状況を参照したい');
  assert.equal(s.idea.find((r) => r[0] === '関係部署')[1], '管理本部・経営企画');
  assert.match(s.idea.find((r) => r[0] === '近い Agent')[1], /該当なし/);
  const photo = scriptedIdea('現場写真の整理に毎週3時間かかっている');
  assert.equal(photo.title, '現場写真の自動整理・台帳化', '既存シナリオの語彙は維持');
});

test('LLM 構造化: fetch モックで LLM が返した agent_id を検証し、未知の id は落とし、既知は段階・部署付きで返す。検証失敗は scripted へ', async () => {
  const { structureIdea } = await import('../src/lib/chat-idea.js');
  const savedFetch = globalThis.fetch;
  const calls = [];
  const good = JSON.stringify({
    title: 'ヘルプデスク履歴の参照', intent: '情報参照 / 分類', risk: 'R1', target_task: '過去の問い合わせ記録の検索と分類', current_state: '担当者の記憶と個別ファイル',
    expected_effect: '対応時間の短縮', required_data: ['問い合わせ記録'], risk_notes: ['個人情報を含む可能性'], departments: ['06', '99'],
    suggested_agents: [{ agent_id: 'knowledge-quality', reason: '記録の品質検査に近い' }, { agent_id: 'made-up', reason: 'x' }], needs_new_agent: true, unknowns: ['対象期間'],
  });
  globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: good }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) }; };
  try {
    const r = await structureIdea({ text: '過去のヘルプデスク状況を参照したい', history: [{ role: 'user', text: '前の相談' }] });
    assert.equal(r.idea.source, 'llm');
    assert.equal(r.idea.title, 'ヘルプデスク履歴の参照');
    assert.deepEqual(r.idea.departments, ['06']);
    assert.deepEqual(r.idea.agents.map((a) => a.agent_id), ['knowledge-quality']);
    assert.equal(r.idea.agents[0].stage, 'P1'); assert.equal(r.idea.agents[0].executable, true);
    assert.equal(r.idea.needs_new_agent, true);
    assert.ok(r.cost > 0 && r.provider === 'deepseek');
    const prompt = calls[0].messages.find((m) => m.role === 'user').content;
    assert.ok(prompt.includes('<untrusted_data>') && prompt.includes('technology-selection'), 'カタログを untrusted_data 内で渡す');
    // 検証失敗（schema に無いフィールド）→ scripted へ縮退
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"x","grant_admin":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
    const d = await structureIdea({ text: '過去のヘルプデスク状況を参照したい' });
    assert.equal(d.idea.source, 'scripted');
    assert.ok(d.idea.llm_degraded);
    // API 失敗 → scripted
    globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
    const e = await structureIdea({ text: 'x' });
    assert.equal(e.idea.source, 'scripted');
  } finally { globalThis.fetch = savedFetch; }
});
