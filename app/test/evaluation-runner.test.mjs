/** 評価ランナー（C-16）のユニットテスト。DB 不要。全 Skill の cases.jsonl が読めることも確認する。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpectations, sampleFromSchema, loadCases, listSkillIds } from '../src/agent-runtime/evaluation-runner.js';
import { loadSkillDefinition } from '../src/agent-runtime/skill-loader.js';
import Ajv from 'ajv';

test('evaluateExpectations: _min / _max / _equals / _includes / 真偽値を判定し、notes は無視する', () => {
  const out = { candidates: [1, 2], unknowns: ['該当なし'], requires_human_review: true, run_count: 3, knowledge_candidate_id: 5 };
  const r = evaluateExpectations({ candidates_min: 2, candidates_max: 2, unknowns_includes: '該当', requires_human_review: true, run_count_min: 1, knowledge_candidate_id_equals: 5, notes: 'x' }, out);
  assert.equal(r.passed, true);
  assert.equal(r.checks.length, 6);
  const bad = evaluateExpectations({ candidates_min: 3, requires_human_review: false, unknowns_includes: '無い語' }, out);
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.checks.map((c) => c.ok), [false, false, false]);
  assert.equal(evaluateExpectations({}, out).passed, true);
  assert.equal(evaluateExpectations({ missing_min: 1 }, out).passed, false, '無いフィールドは不合格');
  assert.equal(evaluateExpectations({ text_includes: 'cd' }, { text: 'abcde' }).passed, true, '文字列フィールドは部分一致');
  assert.equal(evaluateExpectations({ text_includes: 'zz' }, { text: 'abcde' }).passed, false);
});

test('sampleFromSchema: required だけを型どおりに埋めた値を返す', () => {
  const s = sampleFromSchema({ type: 'object', required: ['a', 'b', 'c'], properties: { a: { type: 'array', items: { type: 'string' } }, b: { type: 'integer' }, c: { type: 'boolean' } } });
  assert.deepEqual(s, { a: ['sample'], b: 1, c: true });
});

test('全 Skill に evals/cases.jsonl があり、input が各 Skill の input schema に適合する', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const skillId of listSkillIds('mirai-construction')) {
    const cases = loadCases('mirai-construction', skillId);
    assert.ok(cases.length >= 1, `${skillId}: 評価ケースがありません`);
    const def = loadSkillDefinition('mirai-construction', skillId);
    const validate = ajv.compile(def.inputSchema);
    for (const c of cases) {
      assert.ok(typeof c.case_id === 'string' && c.case_id.length > 0, `${skillId}: case_id`);
      assert.ok(validate(c.input), `${skillId}/${c.case_id}: input が schema に不適合: ${ajv.errorsText(validate.errors)}`);
    }
  }
});
