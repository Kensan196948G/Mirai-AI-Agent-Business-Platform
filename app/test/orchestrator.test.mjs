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
  assert.doesNotThrow(() => validateAgentContractExtensions({ layer: 'civil_expert', org_code: '04', input_contract: { type: 'object', properties: { query: { type: 'string' } } }, technical_risk_class: 'T3', delegates_to: ['technology-selection'], timeout_seconds: 300, budget_usd: 0.5, model_category: 'Independent Review', required_conditions: ['N値'], keywords: ['地盤'] }, 'x'));
  assert.throws(() => validateAgentContractExtensions({ layer: 'civil_expert', technical_risk_class: 'T3' }, 'x'), /required_conditions/, 'civil_expert は必要条件が必須');
  assert.throws(() => validateAgentContractExtensions({ layer: 'civil_expert', required_conditions: ['x'] }, 'x'), /technical_risk_class/, 'civil_expert は技術リスク区分が必須');
  assert.throws(() => validateAgentContractExtensions({ layer: 'other' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ org_code: '10' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ input_contract: { type: 'string' } }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ technical_risk_class: 'T7' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ delegates_to: 'a' }, 'x'), SkillLoaderError);
  assert.throws(() => validateAgentContractExtensions({ budget_usd: -1 }, 'x'), SkillLoaderError);
});

// ---------------------------------------------------------------------------
// 第 3 段: 土木専門 Agent（B-005 委譲、D-011〜D-014 技術リスク、X-001〜X-020 ルーティング）
// ---------------------------------------------------------------------------
import { maxTechnicalRisk } from '../src/agent-runtime/orchestrator.js';
import { technicalRiskPolicy } from '../src/agent-runtime/skill-loader.js';
import { matchByKeywords, findAgent } from '../src/agent-runtime/catalog.js';

const ALL_P1 = loadUnifiedCatalog().agents.filter((a) => a.executable).map((a) => a.agent_id);

test('technicalRiskPolicy: T3 以上は専門技術者レビュー必須、T5/T6 は AI 単独完了不可、不明は何も強制しない', () => {
  assert.deepEqual(technicalRiskPolicy('T2'), { technical_risk_class: 'T2', level: 2, expert_review_required: false, ai_completion_prohibited: false });
  assert.deepEqual(technicalRiskPolicy('T3'), { technical_risk_class: 'T3', level: 3, expert_review_required: true, ai_completion_prohibited: false });
  assert.deepEqual(technicalRiskPolicy('T5'), { technical_risk_class: 'T5', level: 5, expert_review_required: true, ai_completion_prohibited: true });
  assert.deepEqual(technicalRiskPolicy(null), { technical_risk_class: null, level: null, expert_review_required: false, ai_completion_prohibited: false });
  assert.equal(maxTechnicalRisk(['T2', null, 'T4', 'T3']), 'T4');
  assert.equal(maxTechnicalRisk([null]), null);
});

test('scriptedPlan（B-005）: 組織責務 Agent の委譲先にある土木専門 Agent だけを、その後段（depends_on）として起動する', () => {
  const p = scriptedPlan('軟弱地盤の液状化対策の工法を比較したい。N値と地下水位の資料あり', runtimeCatalog(ALL_P1));
  const geo = p.steps.find((s) => s.agent_id === 'geotechnical-expert');
  assert.ok(geo, JSON.stringify(p.steps.map((s) => s.agent_id)));
  assert.equal(geo.depends_on.length, 1, '専門 Agent は委譲元の後段');
  const org = p.steps[geo.depends_on[0] - 1];
  assert.ok(findAgent(org.agent_id).layer === 'organization' && findAgent(org.agent_id).delegates_to.includes('geotechnical-expert'), `委譲元 ${org.agent_id}`);
  assert.match(geo.reason, /委譲/);
  assert.match(p.summary, /土木専門 1 件へ委譲|土木専門/);
  assert.ok(p.steps.every((s) => findAgent(s.agent_id).layer !== 'civil_expert' || s.depends_on.length === 1), '専門 Agent が先頭に来ない');
  // 委譲元が選ばれない要求では、専門用語が一致しても専門 Agent は起動せず rejected に理由が残る
  const q = scriptedPlan('委員会向けに今月の KPI を整理したい。ついでに液状化の話も', runtimeCatalog(ALL_P1));
  assert.ok(!q.steps.some((s) => s.agent_id === 'geotechnical-expert'));
  assert.ok(q.rejected.some((r) => r.agent_id === 'geotechnical-expert' && /委譲先に無い/.test(r.reason)), JSON.stringify(q.rejected));
  // 未承認の専門 Agent は起動しない
  const u = scriptedPlan('軟弱地盤の液状化対策の工法を比較したい', runtimeCatalog(ALL_P1.filter((id) => id !== 'geotechnical-expert')));
  assert.ok(u.rejected.some((r) => r.agent_id === 'geotechnical-expert' && /未承認/.test(r.reason)));
});

test('ルーティング（X-001〜X-020）: 9 種の土木専門 Agent はそれぞれの専門用語で選ばれ、委譲元の組織責務 Agent を持つ', () => {
  const cases = [
    ['port-marine-expert', '港湾の防波堤ケーソン据付の施工計画を検討したい', 'construction-planning-support'],
    ['geotechnical-expert', '地盤改良の工法比較。軟弱地盤で液状化のおそれ', 'research-technology-support'],
    ['structural-expert', '新技術の杭基礎の耐震性能と荷重条件を比較したい', 'research-technology-support'],
    ['construction-planning-expert', '岸壁の施工手順と工程、作業船とクレーンの段取りを検討したい', 'construction-planning-support'],
    ['bim-cim-cad-gis-expert', 'DX 推進で BIM/CIM モデルと点群の座標系を Notion と連携したい', 'external-dx-support'],
    ['environmental-expert', '浚渫工事の環境（濁り・騒音）の安全品質レビューをしたい', 'safety-quality-environment-review'],
    ['maintenance-expert', '支店の地域案件で港湾の点検と補修の維持管理を提案したい', 'branch-support'],
    ['quantity-cost-expert', '経営企画の KPI 向けに数量と積算のコストを整理したい', 'management-planning-support'],
    ['civil-review-expert', '安全品質環境の基準レビューで数値の整合と矛盾を照査したい', 'safety-quality-environment-review'],
  ];
  for (const [expert, text, delegator] of cases) {
    const kw = matchByKeywords(text);
    assert.ok(kw.experts.some((e) => e.agent_id === expert), `${expert}: 専門用語で候補に挙がる（${JSON.stringify(kw.experts)}）`);
    const p = scriptedPlan(text, runtimeCatalog(ALL_P1));
    const step = p.steps.find((s) => s.agent_id === expert);
    assert.ok(step, `${expert}: 司令塔の Step に含まれる（steps=${JSON.stringify(p.steps.map((s) => s.agent_id))}, rejected=${JSON.stringify(p.rejected)}）`);
    const dep = p.steps[step.depends_on[0] - 1];
    assert.ok(findAgent(dep.agent_id).delegates_to.includes(expert), `${expert}: 委譲元 ${dep.agent_id} の delegates_to に含まれる`);
    assert.ok(findAgent(delegator).delegates_to.includes(expert), `${expert}: ${delegator} が委譲先として持つ`);
  }
  // 技術リスクの割り当て: 構造は T5（AI 単独完了不可）、BIM/CIM は T2、港湾・地盤・レビューは T4
  assert.equal(findAgent('structural-expert').technical_risk_class, 'T5');
  assert.equal(findAgent('bim-cim-cad-gis-expert').technical_risk_class, 'T2');
  for (const id of ['port-marine-expert', 'geotechnical-expert', 'civil-review-expert']) assert.equal(findAgent(id).technical_risk_class, 'T4');
  // AI相談: 専門 Agent は「近い Agent」に理由付きで出る
  const kw = matchByKeywords('地盤改良の液状化対策');
  assert.ok(kw.experts.length >= 1 && kw.agents.every((a) => findAgent(a.agent_id).layer !== 'civil_expert'), '組織 Agent の枠を専門 Agent が奪わない');
});
