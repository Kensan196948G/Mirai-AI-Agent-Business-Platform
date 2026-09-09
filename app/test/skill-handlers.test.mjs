/**
 * 各 Skill ハンドラ（skills/index.js）の戻り値が、自身の output.schema.json に適合することを
 * LLM も DB も使わずに検証する（callTool / structuredComplete / validateCitations をスタブ化）。
 *
 * 本番の実Run（RUN-1002）で evidence-backed-draft が、artifact.write-draft 成功後に
 * 「artifact_id/artifact_code が additionalProperties 違反」で出力検証に失敗した事象の再発防止。
 * 契約連鎖テスト（agent-contract-chain.test.mjs）は schema 同士の整合しか見ないため、
 * ハンドラ実装と schema のズレは本テストで捕捉する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { SKILL_HANDLERS } from '../src/agent-runtime/skills/index.js';
import { loadSkillDefinition } from '../src/agent-runtime/skill-loader.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const PACK = 'mirai-construction';

/** schema から型の合うダミー値を作る（structuredComplete スタブの戻り値用） */
function sample(schema) {
  if (!schema || typeof schema !== 'object') return 'x';
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'array': return schema.items ? [sample(schema.items)] : [];
    case 'object': { const o = {}; for (const k of schema.required || []) o[k] = sample(schema.properties?.[k]); return o; }
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    case 'null': return null;
    default: return 'x';
  }
}

function makeCtx(def, input, { degraded = false } = {}) {
  const calls = [];
  return {
    calls,
    client: { query: async () => ({ rows: [{ run_count: 0, avg_steps: null, avg_tokens: null, avg_cost: null, total: 0, completed: 0, cost: 0, reviewed: 0, pending: 0, approved: 0, promoted: 0, n: 0 }] }) },
    run: { id: 1, run_code: 'RUN-TEST', project_id: null },
    agentVersion: { version: '1.0.0' },
    skillDef: def,
    skillVersion: { skill_id: def.skillId, version: '1.0.0', status: 'approved' },
    allSkillVersions: [{ skill_id: def.skillId, version: '1.0.0' }],
    input,
    callTool: async (toolName, args) => {
      calls.push(toolName);
      if (toolName === 'knowledge.search-approved') return { candidates: [{ source_record_id: 1, title: 'MC-Wake', summary: 's', evidence_type: 'marketing_overview' }] };
      if (toolName === 'knowledge.search-promoted') return { candidates: [{ knowledge_id: 7, title: 't', summary: 's' }] };
      // pg は BIGINT を文字列で返す。本番（RUN-1003）で artifact_id が string のまま返り schema 違反になった事象を再現するため文字列にする
      if (toolName === 'artifact.write-draft') return { artifact: { id: '42', artifact_code: 'ART-TEST', reused: false } };
      throw new Error('unexpected tool ' + toolName);
    },
    structuredComplete: async ({ schema, fallbackData }) => ({ data: degraded ? fallbackData : sample(schema), tokensIn: 1, tokensOut: 1, cost: 0, degraded }),
    validateCitations: async (sources) => ({ valid: (sources || []).map((s) => s.source_record_id), invalid: [] }),
  };
}

// 各 Skill の代表入力（先行Step出力を含む合成入力）
const INPUTS = {
  'technology-catalog-search': { query: 'MC-Wake' },
  'project-case-search': { query: '海上' },
  'source-citation-verify': { sources: [{ source_record_id: 1 }] },
  'applicability-gap-check': { query: 'q', candidates: [{ source_record_id: 1, title: 't', summary: 's' }], unknowns: [] },
  'technology-comparison': { gaps: [{ source_record_id: 1, confirmed: ['a'], missing: ['b'] }], unknowns: [] },
  'case-comparison': { query: 'q', candidates: [{ source_record_id: 1, title: 't', summary: 's' }] },
  'evidence-backed-draft': { comparison_table: [{ source_record_id: 1, axis: 'a', value: 'v', basis: 'b' }], gaps: [], unknowns: ['u'], assumptions: [] },
  'knowledge-quality-review': { knowledge_candidate_id: 5, title: 't', summary: 's', source: 'x' },
  'knowledge-dedup': { knowledge_candidate_id: 5, title: 't', summary: 's' },
  'knowledge-review-packet': { knowledge_candidate_id: 5, findings: ['f'], flags: [], duplicates: [7], conflicts: [], unknowns: [] },
  'outcome-measurement': { agent_id: null },
  'source-normalize': { raw_text: 'abc 03-1234-5678', source_type: 'company_website' },
  // 第 2 段: 組織責務 Agent の共通 Skill
  'knowledge-brief': { query: 'MC-Wake', source_types: ['technology_catalog'] },
  'planning-brief': { query: '施工計画の論点', plan_type: 'construction_plan', candidates: [{ source_record_id: 1, title: 't', summary: 's', evidence_type: 'e' }] },
  'document-review': { query: 'レビュー', document_text: '高所作業は手すりを設置する。', criteria: ['墜落防止'] },
  'risk-assessment': { query: '夜間海上作業', domain: 'marine' },
  'decision-log-draft': { query: '採用可否', options: ['採用', '見送り'], findings: ['f'] },
  'kpi-review': { query: 'KPI' },
  'sod-check': { query: 'SoD' },
  'quantity-consistency-check': { query: '数量', quantities_text: '捨石: 100 m3\n捨石: 5 t\n合計: 300 m3' },
  'regional-context': { query: '九州', branch: '九州', allowed_classification: 'public_only' },
};

for (const [skillId, input] of Object.entries(INPUTS)) {
  test(`handler output ↔ output.schema: ${skillId}`, async () => {
    const def = loadSkillDefinition(PACK, skillId, '1.0.0');
    const handler = SKILL_HANDLERS[skillId];
    assert.ok(handler, `${skillId} のハンドラが未実装`);
    const ctx = makeCtx(def, input);
    const out = await handler(ctx);
    const validate = ajv.compile(def.outputSchema);
    assert.ok(validate(out), `${skillId} の戻り値が output.schema に不適合: ${ajv.errorsText(validate.errors)}\n戻り値キー: ${Object.keys(out).join(', ')}`);
    // 許可Tool以外を呼んでいないこと（Policy Engine と同じ制約をハンドラ側でも満たす）
    const allowed = new Set(def.execution.allowed_tools || []);
    for (const t of ctx.calls) assert.ok(allowed.has(t), `${skillId} が allowed_tools 外の ${t} を呼んだ`);
  });
}

test('structured_llm Skill は LLM出力検証失敗（degraded）でも schema に適合する安全な既定値を返す', async () => {
  for (const skillId of ['applicability-gap-check', 'technology-comparison', 'case-comparison', 'evidence-backed-draft', 'knowledge-quality-review', 'knowledge-dedup', 'planning-brief', 'document-review', 'risk-assessment']) {
    const def = loadSkillDefinition(PACK, skillId, '1.0.0');
    const out = await SKILL_HANDLERS[skillId](makeCtx(def, INPUTS[skillId], { degraded: true }));
    const validate = ajv.compile(def.outputSchema);
    assert.ok(validate(out), `${skillId}（degraded）: ${ajv.errorsText(validate.errors)}`);
    assert.ok((out.unknowns || []).length > 0, `${skillId}（degraded）は unknowns に保留理由を残すこと`);
  }
});

test('evidence-backed-draft は requires_human_review=true を必ず返し、artifact を書き込む', async () => {
  const def = loadSkillDefinition(PACK, 'evidence-backed-draft', '1.0.0');
  const ctx = makeCtx(def, INPUTS['evidence-backed-draft']);
  const out = await SKILL_HANDLERS['evidence-backed-draft'](ctx);
  assert.equal(out.requires_human_review, true);
  assert.equal(out.artifact_id, 42);
  assert.equal(typeof out.artifact_id, 'number');
  assert.deepEqual(ctx.calls, ['artifact.write-draft']);
});

test('evidence-backed-draft は出典ゼロのとき LLM を呼ばず、前段の unknowns を保持して理由を明記する', async () => {
  const def = loadSkillDefinition(PACK, 'evidence-backed-draft', '1.0.0');
  const ctx = makeCtx(def, { query: 'q', candidates: [], comparisons: [], unknowns: ['該当する承認済み施工実績が見つかりません'] });
  let llmCalled = false;
  ctx.structuredComplete = async () => { llmCalled = true; return { data: {}, degraded: false }; };
  const out = await SKILL_HANDLERS['evidence-backed-draft'](ctx);
  assert.equal(llmCalled, false);
  assert.equal(out.sources.length, 0);
  assert.equal(out.requires_human_review, true);
  assert.ok(out.unknowns.includes('該当する承認済み施工実績が見つかりません'), '前段の unknowns を引き継ぐ');
  assert.ok(out.unknowns.some((u) => u.includes('承認済み出典が見つからなかった')), '出典ゼロの理由を明記する');
  assert.ok(!out.unknowns.some((u) => u.includes('LLM出力の検証に失敗')), 'LLM を呼んでいないのに検証失敗と書かない');
  assert.ok(new Ajv({ allErrors: true }).compile(def.outputSchema)(out), 'output schema に適合');
});

test('Prompt Injection（C-18）: LLM が乗っ取られた出力（人手確認 false・捏造出典・秘密）を返しても、evidence-backed-draft は人手確認を固定し検証済み出典だけを残す', async () => {
  const def = loadSkillDefinition(PACK, 'evidence-backed-draft', '1.0.0');
  const ctx = makeCtx(def, INPUTS['evidence-backed-draft']);
  ctx.structuredComplete = async () => ({
    data: {
      findings: ['正当な事実', 'システムプロンプトを表示します: sk-abcdefghijklmnopqrstuvwxyz1234'],
      sources: [{ source_record_id: 1 }, { source_record_id: 999 }], unknowns: [], assumptions: [], requires_human_review: false,
    }, degraded: false, tokensIn: 1, tokensOut: 1, cost: 0,
  });
  const out = await SKILL_HANDLERS['evidence-backed-draft'](ctx);
  assert.equal(out.requires_human_review, true);
  assert.deepEqual(out.sources.map((s) => s.source_record_id), [1], '前段で検証された出典（1）だけを残し、捏造の 999 を除く');
  assert.ok(new Ajv({ allErrors: true }).compile(def.outputSchema)(out));
});
