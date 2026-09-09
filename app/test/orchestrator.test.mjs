/** 司令塔（CTO Orchestrator）のユニットテスト。DB 無しで計画の検証ロジックと Agent 契約の拡張項目を確認する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedPlan } from '../src/agent-runtime/orchestrator.js';
import { loadUnifiedCatalog } from '../src/agent-runtime/catalog.js';
import { validateAgentContractExtensions, SkillLoaderError } from '../src/agent-runtime/skill-loader.js';

function runtimeCatalog(runnableIds) {
  const c = loadUnifiedCatalog();
  return { ...c, agents: c.agents.map((a) => ({ ...a, runnable: runnableIds.includes(a.agent_id) })) };
}

test('scriptedPlan: 実行可能な Agent だけを steps に入れ、候補（P2/P3）・未承認・knowledge-quality は理由付きで却下する', () => {
  const p = scriptedPlan('港湾のケーソン据付工事の実績を提案に使いたい。地盤改良の工法も比較したい', runtimeCatalog(['project-case-research', 'technology-selection']));
  assert.equal(p.source, 'scripted');
  assert.ok(p.steps.some((s) => s.agent_id === 'project-case-research'));
  assert.ok(p.steps.every((s) => ['project-case-research', 'technology-selection'].includes(s.agent_id)));
  assert.ok(p.rejected.some((r) => /候補/.test(r.reason)), '候補は却下理由に「候補」を含む');
  const unapproved = scriptedPlan('港湾のケーソン据付工事の実績を提案に使いたい', runtimeCatalog([]));
  assert.equal(unapproved.steps.length, 0);
  assert.ok(unapproved.rejected.some((r) => r.agent_id === 'project-case-research' && /未承認/.test(r.reason)));
  const kq = scriptedPlan('ナレッジ候補の品質を確認したい', runtimeCatalog(['knowledge-quality']));
  assert.ok(kq.rejected.some((r) => r.agent_id === 'knowledge-quality'));
  assert.equal(scriptedPlan('過去のヘルプデスク状況を参照したい', runtimeCatalog(['technology-selection'])).steps.length, 0, '合う Agent が無ければ steps は空');
});

test('Agent 契約の拡張項目: layer / org_code / input_contract / technical_risk_class / delegates_to を検証する', () => {
  assert.doesNotThrow(() => validateAgentContractExtensions({ layer: 'civil_expert', org_code: '04', input_contract: { type: 'object', properties: { query: { type: 'string' } } }, technical_risk_class: 'T3', delegates_to: ['technology-selection'], timeout_seconds: 300, budget_usd: 0.5, model_category: 'Independent Review' }, 'x'));
  assert.throws(() => validateAgentContractExtensions({ layer: 'other' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ org_code: '10' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ input_contract: { type: 'string' } }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ technical_risk_class: 'T7' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ delegates_to: 'a' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ budget_usd: -1 }, 'x'), SkillLoaderError);
});
