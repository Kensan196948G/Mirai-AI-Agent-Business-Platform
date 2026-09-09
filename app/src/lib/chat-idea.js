/**
 * AI相談の IDEA 構造化（LLM 版）。相談文と会話履歴から、対象業務・現状・期待効果・必要データ・リスク候補・
 * 関係部署・近い Agent を JSON Schema 付きで抽出する。業務Agent と同じ構造化出力の仕組み
 * （schema 検証・再試行・Prompt Injection 対策・費用計上）を流用する。
 * LLM 未設定 / 月次上限 / 検証失敗 / API 失敗のときは、ルールベース（シナリオ + 語の一致）へ必ず戻し、
 * 「（相談内容から抽出）」のような未抽出の表示は出さない。
 */
import { matchScenario } from './chatScenarios.js';
import { structuredComplete, isConfigured } from '../agent-runtime/provider-adapter.js';
import { catalogForPrompt, matchByKeywords, validateSuggestions, findAgent } from '../agent-runtime/catalog.js';

const RISKS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

export const IDEA_SCHEMA = {
  type: 'object',
  required: ['title', 'intent', 'risk', 'target_task', 'current_state', 'expected_effect', 'required_data', 'risk_notes', 'departments', 'suggested_agents', 'needs_new_agent', 'unknowns'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    intent: { type: 'string', maxLength: 60 },
    risk: { type: 'string', enum: RISKS },
    target_task: { type: 'string', maxLength: 300 },
    current_state: { type: 'string', maxLength: 300 },
    expected_effect: { type: 'string', maxLength: 300 },
    required_data: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 8 },
    risk_notes: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 6 },
    departments: { type: 'array', items: { type: 'string', maxLength: 4 }, maxItems: 4 },
    suggested_agents: { type: 'array', maxItems: 3, items: { type: 'object', required: ['agent_id', 'reason'], additionalProperties: false, properties: { agent_id: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: 160 } } } },
    needs_new_agent: { type: 'boolean' },
    unknowns: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 6 },
  },
};

const INSTRUCTIONS =
  'あなたは建設会社（みらい建設工業）の DX 相談窓口の整理担当です。利用者の相談文（と会話履歴）から、案件化に向けた IDEA を構造化してください。' +
  '書かれていないことは推測で埋めず、unknowns に「確認が必要な点」として列挙します。' +
  'risk は R0（読み取りのみ）〜R5（人命・法令に直結）で、相談内容の外部影響の大きさから慎重に選びます。' +
  'departments は catalog.organizations の code（例: "04"）だけを使い、suggested_agents は catalog.agents の agent_id だけを使います（無ければ空配列）。' +
  '相談に合う Agent が catalog に無い場合は needs_new_agent を true にします。title は相談の主題を 30 文字程度で。intent は「業務自動化 / 文書生成」のような短い分類。';

function resolveAgents(agentIds, reasons, packId) {
  return agentIds.map((id) => {
    const a = findAgent(id, packId);
    return { agent_id: id, title: a?.title || id, stage: a?.stage || null, dept: a?.dept || null, org_code: a?.org_code || null, layer: a?.layer || 'organization', technical_risk_class: a?.technical_risk_class || null, executable: !!a?.executable, reason: reasons[id] || '' };
  });
}

/** ルールベースの構造化（LLM 未設定時、または LLM 結果の検証失敗時）。 */
export function scriptedIdea(text, packId) {
  const scenario = matchScenario(text);
  const kw = matchByKeywords(text, packId);
  // 組織責務 Agent に続けて、専門用語が一致した土木専門 Agent も「近い Agent」として挙げる（司令塔では委譲元の後段として起動される）
  const agents = resolveAgents([...kw.agents, ...(kw.experts || [])].map((a) => a.agent_id), Object.fromEntries((kw.experts || []).map((e) => [e.agent_id, '専門用語の一致（土木専門 Agent）'])), packId);
  const generic = scenario.match.source === '.';
  const fields = generic
    ? {
        target_task: text.slice(0, 120), current_state: '（未確認）', expected_effect: '（未確認）', required_data: [], risk_notes: [`${scenario.risk} — 読み取り・整理中心の想定`],
        unknowns: ['誰が・どのくらいの頻度で困っているか', '今の対処方法', '成功時に変わってほしいこと'],
      }
    : Object.fromEntries([
        ['target_task', scenario.idea.find((r) => r[0] === '対象業務')?.[1] || ''], ['current_state', scenario.idea.find((r) => r[0] === '現状')?.[1] || ''],
        ['expected_effect', scenario.idea.find((r) => r[0] === '期待効果')?.[1] || ''], ['required_data', [scenario.idea.find((r) => r[0] === '必要データ')?.[1] || ''].filter(Boolean)],
        ['risk_notes', [scenario.idea.find((r) => r[0] === 'リスク候補')?.[1] || ''].filter(Boolean)], ['unknowns', []],
      ]);
  return {
    source: 'scripted', title: scenario.title, intent: scenario.intent, risk: scenario.risk, ...fields,
    departments: kw.departments, agents, needs_new_agent: agents.length === 0, consultation: text,
    idea: toIdeaRows({ ...fields, departments: kw.departments, agents }, packId),
  };
}

function toIdeaRows(f, packId) {
  const cat = catalogForPrompt(packId);
  const deptNames = (f.departments || []).map((c) => cat.organizations.find((o) => o.code === c)?.dept || c);
  const rows = [
    ['対象業務', f.target_task || '（未確認）'], ['現状', f.current_state || '（未確認）'], ['期待効果', f.expected_effect || '（未確認）'],
    ['必要データ', (f.required_data || []).join('、') || '（未確認）'], ['リスク候補', (f.risk_notes || []).join('、') || '（未確認）'],
    ['関係部署', deptNames.join('、') || '（該当なし）'],
    ['近い Agent', (f.agents || []).map((a) => `${a.title}（${a.stage}${a.executable ? '・実行可' : '・候補'}）`).join('、') || '該当なし（追加希望へ）'],
  ];
  if ((f.unknowns || []).length) rows.push(['確認が必要な点', f.unknowns.join('、')]);
  return rows;
}

/**
 * LLM で構造化する。戻り値 { idea, cost, tokensIn, tokensOut, provider, model }。
 * LLM が使えない・失敗した場合は scripted に戻す（idea.source で区別）。
 */
export async function structureIdea({ text, history = [], packId = 'mirai-construction', llmAllowed = true }) {
  if (!llmAllowed || !isConfigured()) return { idea: scriptedIdea(text, packId), cost: 0, tokensIn: 0, tokensOut: 0, provider: null, model: null };
  const fallback = scriptedIdea(text, packId);
  const fallbackData = {
    title: fallback.title, intent: fallback.intent, risk: fallback.risk, target_task: fallback.target_task, current_state: fallback.current_state,
    expected_effect: fallback.expected_effect, required_data: fallback.required_data, risk_notes: fallback.risk_notes,
    departments: fallback.departments, suggested_agents: fallback.agents.map((a) => ({ agent_id: a.agent_id, reason: '語の一致' })), needs_new_agent: fallback.needs_new_agent, unknowns: fallback.unknowns,
  };
  let result;
  try {
    result = await structuredComplete({
      instructions: INSTRUCTIONS,
      input: { consultation: text, history: history.slice(-6).map((h) => ({ role: h.role, text: String(h.text).slice(0, 500) })), catalog: catalogForPrompt(packId) },
      schema: IDEA_SCHEMA, fallbackData,
    });
  } catch (err) {
    return { idea: { ...fallback, llm_error: err.message }, cost: 0, tokensIn: 0, tokensOut: 0, provider: null, model: null };
  }
  if (result.degraded) return { idea: { ...fallback, llm_degraded: result.degradedReason || true }, cost: result.cost || 0, tokensIn: result.tokensIn || 0, tokensOut: result.tokensOut || 0, provider: result.provider, model: result.model };
  const d = result.data;
  const v = validateSuggestions({ agentIds: d.suggested_agents.map((s) => s.agent_id), departments: d.departments }, packId);
  const reasons = Object.fromEntries(d.suggested_agents.map((s) => [s.agent_id, s.reason]));
  // LLM が Agent を挙げなかった場合は語の一致で補う（無ければ「該当なし」を正直に出す）
  const agentIds = v.agentIds.length ? v.agentIds : fallback.agents.map((a) => a.agent_id);
  const agents = resolveAgents(agentIds, reasons, packId);
  const fields = { target_task: d.target_task, current_state: d.current_state, expected_effect: d.expected_effect, required_data: d.required_data, risk_notes: d.risk_notes, unknowns: d.unknowns };
  const idea = {
    source: 'llm', title: d.title, intent: d.intent, risk: d.risk, ...fields,
    departments: v.departments.length ? v.departments : fallback.departments, agents, needs_new_agent: agents.length === 0 || d.needs_new_agent, consultation: text,
    idea: toIdeaRows({ ...fields, departments: v.departments.length ? v.departments : fallback.departments, agents }, packId),
  };
  return { idea, cost: result.cost || 0, tokensIn: result.tokensIn || 0, tokensOut: result.tokensOut || 0, provider: result.provider, model: result.model };
}
