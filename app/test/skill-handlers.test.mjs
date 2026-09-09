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

// ---------------------------------------------------------------------------
// 第 3 段: 土木専門 Agent の決定的 Skill（推測しない・未確定を登録する・単位/座標系/基準面の混在を検出する・基準の版を追跡する）
// ---------------------------------------------------------------------------
test('condition-gap-register: 書かれていない条件は未確定として登録し、「不明」と併記された条件も未確定にする（推測しない）', async () => {
  const def = loadSkillDefinition(PACK, 'condition-gap-register', '1.0.0');
  const ctx = makeCtx(def, { query: '軟弱地盤で N値 3 の粘性土。地下水位は不明。', required_conditions: ['N値', '土質', '地下水位', '層厚'], prior_context: [{ agent_id: 'x', findings: ['層厚 5 m の粘性土層'] }] });
  const out = await SKILL_HANDLERS['condition-gap-register'](ctx);
  assert.ok(ajv.validate(def.outputSchema, out), ajv.errorsText(ajv.errors));
  assert.deepEqual(out.present_conditions, ['N値', '層厚'], '先行 Step の事実（層厚）も記載ありとみなす');
  assert.deepEqual(out.missing_conditions, ['土質', '地下水位'], '「粘性土」から土質を推測しない。「不明」と併記された地下水位も未確定');
  assert.ok(out.unknowns.some((u) => /未確定条件: 地下水位/.test(u)) && out.requires_human_review === true);
  assert.ok(ctx.calls.includes('artifact.write-draft'));
});

test('engineering-consistency-check: 単位系・座標系・基準面の混在を検出し、本文が無ければ判定不能を明示する', async () => {
  const def = loadSkillDefinition(PACK, 'engineering-consistency-check', '1.0.0');
  const out = await SKILL_HANDLERS['engineering-consistency-check'](makeCtx(def, { query: '整合', technical_text: '天端高 T.P.+3.5m、既設は D.L.+2.0m。座標は JGD2011 と一部 JGD2000。荷重 50 kN と 5 tf を併記。延長 100 ft' }));
  assert.ok(ajv.validate(def.outputSchema, out), ajv.errorsText(ajv.errors));
  assert.ok(out.issues.some((i) => /基準面が複数/.test(i)) && out.issues.some((i) => /座標系が複数/.test(i)));
  assert.ok(out.issues.some((i) => /力・荷重の単位系が混在/.test(i)) && out.issues.some((i) => /長さの単位系が混在/.test(i)));
  assert.deepEqual(out.coordinate_systems, ['JGD2011', 'JGD2000']); assert.deepEqual(out.datums, ['TP', 'DL']);
  const empty = await SKILL_HANDLERS['engineering-consistency-check'](makeCtx(def, { query: '整合' }));
  assert.equal(empty.issues.length, 0); assert.ok(empty.unknowns.some((u) => /判定できません/.test(u)));
  // 同一単位系だけなら問題なし（誤検出しない）
  const ok = await SKILL_HANDLERS['engineering-consistency-check'](makeCtx(def, { query: '整合', technical_text: '幅 10 m、高さ 3.5 m、荷重 50 kN、座標 JGD2011、T.P.+2.0m' }));
  assert.equal(ok.issues.length, 0);
});

test('standard-reference-check: 承認済み出典の版・発行日を references に残し、同一タイトルの複数版と社内基準の未登録を明示する', async () => {
  const def = loadSkillDefinition(PACK, 'standard-reference-check', '1.0.0');
  const ctx = makeCtx(def, { query: '防波堤 設計' });
  ctx.callTool = async (toolName, args) => {
    ctx.calls.push(toolName);
    if (toolName === 'knowledge.search-approved') {
      assert.equal(args.withMeta, true, '版・発行日を要求する');
      return args.sourceType === 'technology_catalog' ? { candidates: [
        { source_record_id: 1, title: '港湾の施設の技術上の基準', summary: 's', evidence_type: 'standard', source_type: 'technology_catalog', version: 1, published_at: '2018-05-01', effective_to: null },
        { source_record_id: 2, title: '港湾の施設の技術上の基準', summary: 's', evidence_type: 'standard', source_type: 'technology_catalog', version: 2, published_at: '2024-04-01', effective_to: null },
      ] } : { candidates: [] };
    }
    if (toolName === 'artifact.write-draft') return { artifact: { id: '42', artifact_code: 'ART-TEST', reused: false } };
    throw new Error('unexpected tool ' + toolName);
  };
  const out = await SKILL_HANDLERS['standard-reference-check'](ctx);
  assert.ok(ajv.validate(def.outputSchema, out), ajv.errorsText(ajv.errors));
  assert.equal(out.references.length, 2);
  assert.ok(out.issues.some((i) => /複数の版/.test(i)));
  assert.ok(out.unknowns.some((u) => /社内基準.*未登録/.test(u)));
});

// ---------------------------------------------------------------------------
// 第 4 段: Cross Review（機械検査 + 独立レビュー。判定は機械検査より緩められない）
// ---------------------------------------------------------------------------
import { machineCrossCheck } from '../src/agent-runtime/skills/index.js';
import { ProviderNotConfiguredError } from '../src/agent-runtime/provider-adapter.js';

const PRIOR = [
  { agent_id: 'a', artifact_code: 'ART-1', findings: ['捨石: 100 m3', '天端 T.P.+3.0m'], unknowns: [], assumptions: ['前提 A'], sources: [{ source_record_id: 1 }] },
  { agent_id: 'b', artifact_code: 'ART-2', findings: ['捨石: 120 m3', '既設 D.L.+1.5m'], unknowns: ['x'], assumptions: [], sources: [] },
];

test('machineCrossCheck: Agent 間の数値矛盾は FAIL、基準面の混在は units、根拠の無い事実を挙げる。矛盾が無ければ PASS', () => {
  const r = machineCrossCheck(PRIOR);
  assert.equal(r.verdict, 'FAIL');
  assert.ok(r.contradictions.some((c) => c.type === 'numbers' && /捨石/.test(c.detail) && c.agents.length === 2));
  assert.ok(r.contradictions.some((c) => c.type === 'units' && /基準面/.test(c.detail)));
  assert.equal(r.unsupported.length, 1);
  assert.equal(machineCrossCheck([{ agent_id: 'a', findings: ['捨石: 100 m3'], sources: [{ source_record_id: 1 }] }, { agent_id: 'b', findings: ['捨石: 100 m3'], sources: [{ source_record_id: 1 }] }]).verdict, 'PASS', '同じ値なら矛盾ではない');
  assert.equal(machineCrossCheck([{ agent_id: 'a', findings: ['捨石: 100 m3', '捨石: 120 m3'], sources: [{ source_record_id: 1 }] }]).verdict, 'PASS', '同一 Agent 内の複数値は Agent 間矛盾に数えない');
});

test('cross-review: LLM 未設定では機械検査のみで PASS にせず（CONDITIONAL）、LLM の緩い判定は機械検査へ引き上げ、成果が無ければ判定不能', async () => {
  const def = loadSkillDefinition(PACK, 'cross-review', '1.0.0');
  // LLM 未設定 + 矛盾なし → CONDITIONAL（独立レビュー未実施を明示）
  const ctxNoLlm = makeCtx(def, { query: 'q', prior_context: [{ agent_id: 'a', artifact_code: 'ART-1', findings: ['捨石: 100 m3'], unknowns: [], assumptions: [], sources: [{ source_record_id: 1 }] }] });
  ctxNoLlm.structuredComplete = async () => { throw new ProviderNotConfiguredError('LLM未設定'); };
  const o1 = await SKILL_HANDLERS['cross-review'](ctxNoLlm);
  assert.ok(ajv.validate(def.outputSchema, o1), ajv.errorsText(ajv.errors));
  assert.equal(o1.verdict, 'CONDITIONAL'); assert.equal(o1.review_source, 'machine_only'); assert.equal(o1.human_review_forced, false);
  assert.ok(o1.unknowns.some((u) => /PASS とは判定しない/.test(u)));
  // LLM が PASS と言っても機械検査が FAIL なら FAIL（同じ回答を追認しない）
  const ctxLlm = makeCtx(def, { query: 'q', prior_context: PRIOR });
  ctxLlm.structuredComplete = async () => ({ data: { verdict: 'PASS', confidence: 0.9, contradictions: [], unsupported_claims: [], minority_opinions: ['b は別工法を推奨'], unknowns: [], reasons: ['問題なし'] }, degraded: false, tokensIn: 1, tokensOut: 1, cost: 0 });
  const o2 = await SKILL_HANDLERS['cross-review'](ctxLlm);
  assert.equal(o2.verdict, 'FAIL'); assert.equal(o2.review_source, 'llm'); assert.equal(o2.human_review_forced, true);
  assert.deepEqual(o2.minority_opinions, ['b は別工法を推奨'], '少数意見を消さない');
  assert.ok(o2.contradictions.some((c) => c.type === 'numbers'));
  // 成果なし
  const o3 = await SKILL_HANDLERS['cross-review'](makeCtx(def, { query: 'q', prior_context: [] }));
  assert.equal(o3.verdict, 'CONDITIONAL'); assert.equal(o3.confidence, 0);
});
