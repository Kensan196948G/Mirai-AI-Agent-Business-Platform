/**
 * Skill 評価ランナー（C-16）。各 Skill の evals/cases.jsonl を実行し、期待値と output schema で合否を判定する。
 *
 * モード:
 *   offline（既定）: LLM を呼ばず、output schema から型の合う代表値を返すスタブを使う（費用ゼロ・決定的）。
 *                    決定的 Skill（検索・引用検証・正規化・パケット作成）はこれで実挙動を評価できる。
 *   live:            provider-adapter を通して実 LLM を呼ぶ（費用が発生。Skill 改訂前後の品質比較に使う）。
 * 副作用: Tool は読み取り専用のみ実行し、artifact.write-draft はスタブ。run_events / artifacts へ書かない。
 *
 * cases.jsonl の 1 行: { case_id, input, expect: { <field>_min, <field>_max, <field>_equals, <field>_includes, requires_human_review, notes } }
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { loadSkillDefinition, DOMAIN_PACKS_ROOT } from './skill-loader.js';
import { SKILL_HANDLERS } from './skills/index.js';
import { invokeToolForEvaluation } from './tool-gateway.js';
import { validateCitations } from './evidence-validator.js';
import { structuredComplete as liveStructuredComplete } from './provider-adapter.js';

const ajv = new Ajv({ allErrors: true, strict: false });

/** schema から型の合う代表値を作る（offline モードの LLM スタブ）。 */
export function sampleFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return 'sample';
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'array': return schema.items ? [sampleFromSchema(schema.items)] : [];
    case 'object': { const o = {}; for (const k of schema.required || []) o[k] = sampleFromSchema(schema.properties?.[k]); return o; }
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    case 'null': return null;
    default: return 'sample';
  }
}

export function loadCases(packId, skillId) {
  const path = join(DOMAIN_PACKS_ROOT, packId, 'skills', skillId, 'evals', 'cases.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const c = JSON.parse(line);
    if (!c.case_id || typeof c.input !== 'object') throw new Error(`${skillId} cases.jsonl ${i + 1} 行目: case_id / input が必要です`);
    return c;
  });
}

export function listSkillIds(packId) {
  return readdirSync(join(DOMAIN_PACKS_ROOT, packId, 'skills')).filter((d) => !d.startsWith('.')).sort();
}

/**
 * 期待値の判定。戻り値 { passed, checks: [{ key, expected, actual, ok }] }
 *  <field>_min / _max: 配列長または数値、<field>_equals: 深い等価、<field>_includes: 配列の要素（要素が文字列なら部分一致）または文字列フィールドの部分一致
 *  requires_human_review: boolean、notes: 判定しない
 */
export function evaluateExpectations(expect, output) {
  const checks = [];
  for (const [key, expected] of Object.entries(expect || {})) {
    if (key === 'notes') continue;
    let m;
    if ((m = /^(.+)_min$/.exec(key))) {
      const v = output[m[1]]; const n = Array.isArray(v) ? v.length : Number(v);
      checks.push({ key, expected: `>= ${expected}`, actual: n, ok: Number.isFinite(n) && n >= expected });
    } else if ((m = /^(.+)_max$/.exec(key))) {
      const v = output[m[1]]; const n = Array.isArray(v) ? v.length : Number(v);
      checks.push({ key, expected: `<= ${expected}`, actual: n, ok: Number.isFinite(n) && n <= expected });
    } else if ((m = /^(.+)_equals$/.exec(key))) {
      const v = output[m[1]];
      checks.push({ key, expected, actual: v, ok: JSON.stringify(v) === JSON.stringify(expected) });
    } else if ((m = /^(.+)_includes$/.exec(key))) {
      const raw = output[m[1]];
      if (typeof raw === 'string') {
        // 文字列フィールドは部分一致
        checks.push({ key, expected, actual: raw.slice(0, 120), ok: typeof expected === 'string' && raw.includes(expected) });
      } else {
        const v = Array.isArray(raw) ? raw : [];
        const ok = v.some((x) => (typeof x === 'string' && typeof expected === 'string') ? x.includes(expected) : JSON.stringify(x) === JSON.stringify(expected));
        checks.push({ key, expected, actual: v.slice(0, 5), ok });
      }
    } else {
      checks.push({ key, expected, actual: output[key], ok: JSON.stringify(output[key]) === JSON.stringify(expected) });
    }
  }
  return { passed: checks.every((c) => c.ok), checks };
}

function makeEvalCtx({ client, def, input, mode, usage }) {
  const run = { id: 0, run_code: 'RUN-EVAL', project_id: null, agent_id: 'evaluation', input_json: input };
  return {
    client, run, input, skillDef: def,
    agentVersion: { version: 'eval' },
    skillVersion: { skill_id: def.skillId, version: def.execution.version, status: 'approved' },
    allSkillVersions: [{ skill_id: def.skillId, version: def.execution.version }],
    callTool: (toolName, args) => invokeToolForEvaluation(client, toolName, args),
    validateCitations: (sources) => validateCitations(client, { run, sources }),
    structuredComplete: async (opts) => {
      if (mode === 'live') {
        const r = await liveStructuredComplete(opts);
        usage.cost += r.cost || 0; usage.tokensIn += r.tokensIn || 0; usage.tokensOut += r.tokensOut || 0; usage.llmCalls++;
        return r;
      }
      usage.llmCalls++;
      return { data: sampleFromSchema(opts.schema), tokensIn: 0, tokensOut: 0, cost: 0, degraded: false };
    },
  };
}

/**
 * 1 Skill の全ケースを実行する。戻り値: [{ case_id, passed, checks, schema_ok, output_summary, error, duration_ms, cost_usd, llm_calls }]
 */
export async function evaluateSkill(client, { packId, skillId, mode = 'offline', onlyCase = null }) {
  const def = loadSkillDefinition(packId, skillId);
  const handler = SKILL_HANDLERS[skillId];
  const validateOutput = ajv.compile(def.outputSchema);
  const results = [];
  for (const c of loadCases(packId, skillId)) {
    if (onlyCase && c.case_id !== onlyCase) continue;
    const started = Date.now();
    const usage = { cost: 0, tokensIn: 0, tokensOut: 0, llmCalls: 0 };
    let output = null, error = null, schemaOk = false, expectation = { passed: false, checks: [] };
    try {
      if (!handler) throw new Error(`Skill の実装がありません: ${skillId}`);
      output = await handler(makeEvalCtx({ client, def, input: c.input, mode, usage }));
      schemaOk = validateOutput(output);
      if (!schemaOk) error = `output schema 違反: ${ajv.errorsText(validateOutput.errors)}`;
      expectation = evaluateExpectations(c.expect, output || {});
    } catch (e) {
      error = e.message;
    }
    results.push({
      case_id: c.case_id, passed: schemaOk && !error && expectation.passed, schema_ok: schemaOk, checks: expectation.checks,
      output_summary: summarize(output), error, duration_ms: Date.now() - started, cost_usd: usage.cost, llm_calls: usage.llmCalls, notes: c.expect?.notes || null,
    });
  }
  return { def, results };
}

function summarize(output) {
  if (!output || typeof output !== 'object') return null;
  return Object.fromEntries(Object.entries(output).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : (typeof v === 'object' && v !== null ? 'object' : v)]));
}

/** 結果を skill_evaluations に保存する（batch 単位）。 */
export async function recordEvaluation(client, { batchId, def, mode, results, evaluatedBy }) {
  const { rows } = await client.query(`SELECT id FROM skill_versions WHERE skill_id = $1 AND version = $2`, [def.skillId, def.execution.version]);
  for (const r of results) {
    await client.query(
      `INSERT INTO skill_evaluations (batch_id, skill_id, version, content_hash, skill_version_id, mode, case_id, passed, details, duration_ms, cost_usd, evaluated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [batchId, def.skillId, def.execution.version, def.contentHash, rows[0]?.id || null, mode, r.case_id, r.passed,
        JSON.stringify({ checks: r.checks, schema_ok: r.schema_ok, output_summary: r.output_summary, error: r.error, llm_calls: r.llm_calls, notes: r.notes }),
        r.duration_ms, r.cost_usd, evaluatedBy || null],
    );
  }
}

/** 全 Skill を評価して保存する。戻り値 { batchId, skills: [{ skill_id, version, content_hash, total, passed, results }] } */
export async function evaluatePack(client, { packId, mode = 'offline', skillIds = null, record = true, evaluatedBy = null }) {
  const batchId = `eval-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomUUID().slice(0, 6)}`;
  const skills = [];
  for (const skillId of skillIds || listSkillIds(packId)) {
    const { def, results } = await evaluateSkill(client, { packId, skillId, mode });
    if (record && results.length > 0) await recordEvaluation(client, { batchId, def, mode, results, evaluatedBy });
    skills.push({ skill_id: skillId, version: def.execution.version, content_hash: def.contentHash, total: results.length, passed: results.filter((r) => r.passed).length, results });
  }
  return { batchId, skills };
}

/** 版（内容ハッシュ）ごとの最新バッチの合格率と、直前バッチとの差（回帰したケース）。 */
export async function evaluationSummary(client, { skillId }) {
  const { rows } = await client.query(
    `SELECT batch_id, version, content_hash, mode, count(*)::int AS total, count(*) FILTER (WHERE passed)::int AS passed,
            MIN(created_at) AS created_at, SUM(cost_usd)::float AS cost_usd,
            array_agg(case_id ORDER BY case_id) FILTER (WHERE NOT passed) AS failed_cases
     FROM skill_evaluations WHERE skill_id = $1
     GROUP BY batch_id, version, content_hash, mode ORDER BY MIN(created_at) DESC LIMIT 20`,
    [skillId],
  );
  const batches = rows.map((r) => ({ ...r, failed_cases: r.failed_cases || [], pass_rate: r.total ? r.passed / r.total : null }));
  let regression = null;
  if (batches.length >= 2) {
    const [latest, previous] = batches;
    const newlyFailed = latest.failed_cases.filter((c) => !previous.failed_cases.includes(c));
    const fixed = previous.failed_cases.filter((c) => !latest.failed_cases.includes(c));
    regression = { against_batch: previous.batch_id, content_changed: latest.content_hash !== previous.content_hash, newly_failed: newlyFailed, fixed };
  }
  return { latest: batches[0] || null, batches, regression };
}
