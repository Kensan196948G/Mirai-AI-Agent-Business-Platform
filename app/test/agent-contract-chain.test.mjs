/**
 * Agent の Step 連鎖における入出力契約の整合を、LLM も DB も使わずに検証する。
 *
 * workflow-engine は「Run の入力 + 先行 Step の出力（unknowns/assumptions は蓄積）」を
 * 次 Step の入力としてそのまま渡す。したがって各 Step の input.schema.json は、
 * 先行 Step が返し得る全てのトップレベル項目を受け入れなければならない
 * （additionalProperties:false は先頭 Step 以外では契約違反になる）。
 *
 * 本番で technology-comparison が「data must NOT have additional properties」で失敗した
 * 事象（テスト環境では LLM Step の手前で止まるため未検出だった）の再発防止。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { loadAgentDefinition, loadSkillDefinition } from '../src/agent-runtime/skill-loader.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const PACK = 'mirai-construction';
const AGENTS = ['technology-selection', 'project-case-research', 'knowledge-quality'];
// routes/agent-runs.js の AGENT_INPUT_ALLOWLIST と同じ Run 入力
const RUN_INPUT = {
  'technology-selection': { query: 'q' },
  'project-case-research': { query: 'q' },
  'knowledge-quality': { knowledge_candidate_id: 1, title: 't', summary: 's', source: 'x' },
};
const ACCUMULATING = new Set(['unknowns', 'assumptions']); // workflow-engine.js と同じ

/** JSON Schema から「最小限だが型が合う」ダミー値を生成する。 */
function sample(schema) {
  if (!schema || typeof schema !== 'object') return 'x';
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'array': return schema.items ? [sample(schema.items)] : [];
    case 'object': {
      const o = {};
      for (const k of schema.required || []) o[k] = sample(schema.properties?.[k]);
      return o;
    }
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    case 'null': return null;
    default: return 'x';
  }
}

for (const agentId of AGENTS) {
  test(`contract chain: ${agentId} の全Stepで先行Step出力を含む入力が input.schema に適合する`, () => {
    const { definition } = loadAgentDefinition(PACK, agentId);
    let merged = { ...RUN_INPUT[agentId] };
    definition.skills.forEach((s, idx) => {
      const def = loadSkillDefinition(PACK, s.skill_id, s.version);
      const validate = ajv.compile(def.inputSchema);
      assert.ok(
        validate(merged),
        `Step${idx + 1} ${s.skill_id} の入力検証に失敗: ${ajv.errorsText(validate.errors)}\n入力キー: ${Object.keys(merged).join(', ')}`,
      );
      // この Step が返す出力（ダミー）を、workflow-engine と同じ規則で次 Step の入力へ合成する
      const out = sample(def.outputSchema);
      for (const [k, v] of Object.entries(out)) {
        merged[k] = ACCUMULATING.has(k) && Array.isArray(v) ? [...(merged[k] || []), ...v] : v;
      }
    });
  });
}

test('contract chain: 先頭Step以外の input.schema は additionalProperties:false を持たない', () => {
  for (const agentId of AGENTS) {
    const { definition } = loadAgentDefinition(PACK, agentId);
    definition.skills.slice(1).forEach((s) => {
      const def = loadSkillDefinition(PACK, s.skill_id, s.version);
      assert.notEqual(def.inputSchema.additionalProperties, false,
        `${agentId} の非先頭Step ${s.skill_id} が additionalProperties:false を持っている`);
    });
  }
});
