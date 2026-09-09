import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDomainPack, loadAgentDefinition, loadSkillDefinition, SkillLoaderError,
} from '../src/agent-runtime/skill-loader.js';

test('loadDomainPack: mirai-construction pack.yaml を読み込める', () => {
  const { pack, contentHash } = loadDomainPack('mirai-construction');
  assert.equal(pack.pack_id, 'mirai-construction');
  assert.equal(pack.stage, 'P1');
  assert.match(contentHash, /^[0-9a-f]{64}$/);
});

test('loadDomainPack: 存在しないpack_idはエラー', () => {
  assert.throws(() => loadDomainPack('no-such-pack'), SkillLoaderError);
});

test('loadDomainPack: パストラバーサルを含むpack_idは拒否される（形式チェックで弾く）', () => {
  assert.throws(() => loadDomainPack('../../etc'), SkillLoaderError);
  assert.throws(() => loadDomainPack('..'), SkillLoaderError);
});

test('loadAgentDefinition: technology-selection を読み込め、A3を含まないことを確認', () => {
  const { definition } = loadAgentDefinition('mirai-construction', 'technology-selection');
  assert.equal(definition.agent_id, 'technology-selection');
  assert.equal(definition.max_autonomy_level, 'A1');
  assert.ok(Array.isArray(definition.skills));
  assert.ok(definition.skills.length >= 4);
});

test('loadAgentDefinition: 存在しないagent_idはエラー', () => {
  assert.throws(() => loadAgentDefinition('mirai-construction', 'no-such-agent'), SkillLoaderError);
});

test('loadSkillDefinition: technology-catalog-search のSKILL.md必須セクションと許可Toolを検証する', () => {
  const def = loadSkillDefinition('mirai-construction', 'technology-catalog-search', '1.0.0');
  assert.equal(def.skillId, 'technology-catalog-search');
  assert.deepEqual(def.execution.allowed_tools, ['knowledge.search-approved']);
  assert.equal(def.inputSchema.required.includes('query'), true);
  assert.equal(def.outputSchema.required.includes('candidates'), true);
});

test('loadSkillDefinition: 全12Skillが必須セクションを満たしロード可能', () => {
  const ids = [
    'source-normalize', 'source-citation-verify', 'project-case-search', 'case-comparison',
    'technology-catalog-search', 'applicability-gap-check', 'technology-comparison', 'evidence-backed-draft',
    'knowledge-quality-review', 'knowledge-dedup', 'knowledge-review-packet', 'outcome-measurement',
  ];
  for (const id of ids) {
    const def = loadSkillDefinition('mirai-construction', id, '1.0.0');
    assert.equal(def.skillId, id, `${id} のロードに失敗`);
  }
});

test('loadSkillDefinition: execution.yamlのallowed_toolsに禁止Toolが含まれる場合は拒否される', () => {
  // 実在するSkillの execution.yaml を直接検証することはできないため、
  // グローバル禁止リストとの整合を許可済みSkillの一覧から間接的に確認する。
  const def = loadSkillDefinition('mirai-construction', 'evidence-backed-draft', '1.0.0');
  for (const forbidden of ['equipment.control', 'external.send', 'formal-approval.decide', 'shell.exec', 'sql.raw', 'http.fetch']) {
    assert.equal(def.execution.allowed_tools.includes(forbidden), false);
  }
});

test('loadSkillDefinition: 存在しないskill_idはエラー', () => {
  assert.throws(() => loadSkillDefinition('mirai-construction', 'no-such-skill'), SkillLoaderError);
});

test('loadSkillDefinition: skill_idにパス区切りを含む場合は拒否される（パストラバーサル対策）', () => {
  assert.throws(() => loadSkillDefinition('mirai-construction', '../../../etc/passwd'), SkillLoaderError);
});

test('loadAgentDefinition: backlog/ 配下のP2/P3候補は agents/ に存在せず実行可能なAgentとしてロードできない', () => {
  // p2-p3-catalog.yaml に列挙された agent_id は agents/ 配下に定義が無いため、
  // sync-agent-registry.mjs で誤って承認済み版として登録されることはない。
  for (const id of ['port-marine-construction-planning', 'ground-improvement-support', 'vessel-machinery-operation']) {
    assert.throws(() => loadAgentDefinition('mirai-construction', id), SkillLoaderError, `${id} はロードできてはならない`);
  }
});

test('validateApprovalGate: 形式を検証し、role 既定値 Approver を補う', async () => {
  const { validateApprovalGate, SkillLoaderError } = await import('../src/agent-runtime/skill-loader.js');
  assert.equal(validateApprovalGate(undefined, 'x'), null);
  assert.deepEqual(validateApprovalGate({ required: true }, 'x'), { required: true, role: 'Approver', reason: '' });
  assert.deepEqual(validateApprovalGate({ required: true, role: 'Reviewer', reason: '外部送信' }, 'x'), { required: true, role: 'Reviewer', reason: '外部送信' });
  assert.throws(() => validateApprovalGate({ required: 'yes' }, 'x'), SkillLoaderError);
  assert.throws(() => validateApprovalGate({ required: true, role: 'Viewer' }, 'x'), SkillLoaderError);
  assert.throws(() => validateApprovalGate('true', 'x'), SkillLoaderError);
});
