/**
 * 各SkillのJS実装。SKILL.md/execution.yamlが「契約」（目的・入出力Schema・許可Tool）を定義し、
 * ここでの実装がその契約を満たす（workflow-engineが呼び出し前後にJSON Schema検証を行う）。
 *
 * 各ハンドラのシグネチャ: async (ctx) => output
 * ctx = { client, run, skillVersion, input, callTool, structuredComplete, validateCitations, nextSeq }
 */

import { sanitizeUntrustedText, scanForInjection, scanForSecrets } from '../prompt-guard.js';
import { ProviderNotConfiguredError } from '../provider-adapter.js';

async function technologyCatalogSearch(ctx) {
  const result = await ctx.callTool('knowledge.search-approved', {
    query: ctx.input.query, sourceType: 'technology_catalog', projectId: ctx.run.project_id,
  });
  const unknowns = result.candidates.length === 0 ? ['該当する承認済み技術カタログが見つかりません'] : [];
  return { candidates: result.candidates, unknowns };
}

async function projectCaseSearch(ctx) {
  const result = await ctx.callTool('knowledge.search-approved', {
    query: ctx.input.query, sourceType: 'project_case', projectId: ctx.run.project_id,
  });
  const unknowns = result.candidates.length === 0 ? ['該当する承認済み施工実績が見つかりません'] : [];
  return { candidates: result.candidates, unknowns };
}

async function sourceCitationVerify(ctx) {
  const { valid, invalid } = await ctx.validateCitations(ctx.input.sources || []);
  return { valid, invalid };
}

async function applicabilityGapCheck(ctx) {
  const fallback = { gaps: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'], assumptions: [] };
  if ((ctx.input.candidates || []).length === 0) {
    return { gaps: [], unknowns: ctx.input.unknowns || [], assumptions: [] };
  }
  const { data, degraded } = await ctx.structuredComplete({
    instructions:
      '以下の技術候補それぞれについて、summaryに明記されている内容のみを根拠に、確認できた適用条件(confirmed)と' +
      'まだ確認できていない不足条件(missing)を分離してください。summaryに書かれていない性能値・適用限界を推測しないでください。',
    input: { query: ctx.input.query, candidates: ctx.input.candidates },
    schema: ctx.skillDef.outputSchema,
    fallbackData: fallback,
  });
  return degraded ? fallback : data;
}

async function technologyComparison(ctx) {
  const fallback = { comparison_table: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'] };
  if ((ctx.input.gaps || []).length === 0) return { comparison_table: [], unknowns: ctx.input.unknowns || [] };
  const { data, degraded } = await ctx.structuredComplete({
    instructions:
      '各候補のconfirmed/missingから、比較軸ごとの比較表を作成してください。confirmedに記載が無い軸は' +
      '断定せず、valueを"不明"としてunknownsへ記載してください。異なる機能を同一視しないでください。',
    input: { gaps: ctx.input.gaps },
    schema: ctx.skillDef.outputSchema,
    fallbackData: fallback,
  });
  return degraded ? fallback : data;
}

async function caseComparison(ctx) {
  const fallback = { comparisons: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'] };
  if ((ctx.input.candidates || []).length === 0) return { comparisons: [], unknowns: ctx.input.unknowns || [] };
  const { data, degraded } = await ctx.structuredComplete({
    instructions: '各施工実績候補について、summaryに基づく類似点(similarities)と相違点(differences)を整理してください。',
    input: { query: ctx.input.query, candidates: ctx.input.candidates },
    schema: ctx.skillDef.outputSchema,
    fallbackData: fallback,
  });
  return degraded ? fallback : data;
}

async function evidenceBackedDraft(ctx) {
  const draftSources = collectSources(ctx.input);
  const { valid, invalid } = await ctx.validateCitations(draftSources.map((id) => ({ source_record_id: id })));

  // 前段 Step までに積み上がった不明点は、LLM を呼ばない場合や degraded 時にも失わない
  const priorUnknowns = ctx.input.unknowns || [];
  const fallback = {
    findings: [], sources: valid.map((id) => ({ source_record_id: id })),
    unknowns: [...priorUnknowns, 'LLM出力の検証に失敗したため保留（人手確認が必要）'], assumptions: ctx.input.assumptions || [],
    requires_human_review: true,
  };

  let output;
  if (draftSources.length > 0 || (ctx.input.comparison_table || []).length > 0) {
    const { data, degraded } = await ctx.structuredComplete({
      instructions:
        'これまでの比較結果・不足情報から、findings(確認できた事実)・unknowns(不明点)・assumptions(仮定)を' +
        '統合してください。sourcesには実際に根拠にしたsource_record_idのみを含めてください。' +
        'requires_human_reviewは常にtrueにしてください。',
      input: ctx.input,
      schema: ctx.skillDef.outputSchema,
      fallbackData: fallback,
    });
    output = degraded ? fallback : data;
  } else {
    // 根拠となる承認済み出典が 1 件もない場合は LLM を呼ばず（推測で草案を書かせない）、その旨を明記する
    output = {
      findings: [], sources: [],
      unknowns: [...priorUnknowns, '根拠となる承認済み出典が見つからなかったため、草案は作成していません（出典の登録または検索条件の見直しが必要）'],
      assumptions: ctx.input.assumptions || [], requires_human_review: true,
    };
  }

  // 引用検証で無効と判定されたsourceは、成果物保存前に取り除き、unknownsへ差し戻す。
  const validSet = new Set(valid);
  const filteredSources = (output.sources || []).filter((s) => validSet.has(s.source_record_id));
  const removedNote = invalid.length > 0 ? [`根拠として無効な引用を${invalid.length}件除去しました`] : [];

  const finalOutput = {
    ...output,
    sources: filteredSources,
    unknowns: [...(output.unknowns || []), ...removedNote],
    requires_human_review: true,
  };

  const artifactResult = await ctx.callTool('artifact.write-draft', {
    kind: 'evidence_backed_draft',
    title: `Run ${ctx.run.run_code} 草案`,
    content: {
      ...finalOutput,
      agent_version: ctx.agentVersion.version,
      skill_versions: Object.fromEntries(ctx.allSkillVersions.map((s) => [s.skill_id, s.version])),
    },
  });

  return { ...finalOutput, artifact_id: Number(artifactResult.artifact.id), artifact_code: artifactResult.artifact.artifact_code };
}

function collectSources(input) {
  const ids = new Set();
  for (const g of input.gaps || []) ids.add(g.source_record_id);
  for (const c of input.comparison_table || []) ids.add(c.source_record_id);
  for (const c of input.comparisons || []) ids.add(c.source_record_id);
  return [...ids].filter((id) => id !== undefined && id !== null);
}

async function knowledgeQualityReview(ctx) {
  const { data, degraded } = await ctx.structuredComplete({
    instructions:
      'Knowledge候補のtitle/summaryを検査し、具体的根拠(出典・数値・手順)があるかをfindingsに、' +
      '個人情報・位置情報・社外秘らしき記述があればflagsに記録してください。',
    input: { title: ctx.input.title, summary: ctx.input.summary, source: ctx.input.source },
    schema: ctx.skillDef.outputSchema,
    fallbackData: { knowledge_candidate_id: ctx.input.knowledge_candidate_id, findings: [], flags: [], unknowns: ['LLM出力の検証に失敗したため保留'] },
  });
  const out = degraded ? data : data;
  return { ...out, knowledge_candidate_id: ctx.input.knowledge_candidate_id };
}

async function knowledgeDedup(ctx) {
  // knowledge_candidates（昇格済みKnowledge）を検索する。source_records（技術カタログ等の出典）とは別物。
  const searchResult = await ctx.callTool('knowledge.search-promoted', { query: ctx.input.title });
  if (searchResult.candidates.length === 0) {
    return { knowledge_candidate_id: ctx.input.knowledge_candidate_id, duplicates: [], conflicts: [], unknowns: [] };
  }
  const { data, degraded } = await ctx.structuredComplete({
    instructions:
      '新規Knowledge候補と既存候補一覧を比較し、内容が一致・包含関係にあるものをduplicatesへ、' +
      '矛盾する記述をconflictsへ分けてください（矛盾を重複として扱わない）。',
    input: { candidate: { title: ctx.input.title, summary: ctx.input.summary }, existing: searchResult.candidates },
    schema: ctx.skillDef.outputSchema,
    fallbackData: { knowledge_candidate_id: ctx.input.knowledge_candidate_id, duplicates: [], conflicts: [], unknowns: ['LLM出力の検証に失敗したため保留'] },
  });
  return { ...data, knowledge_candidate_id: ctx.input.knowledge_candidate_id };
}

async function knowledgeReviewPacket(ctx) {
  const packet = {
    knowledge_candidate_id: ctx.input.knowledge_candidate_id,
    findings: ctx.input.findings || [],
    flags: ctx.input.flags || [],
    duplicates: ctx.input.duplicates || [],
    conflicts: ctx.input.conflicts || [],
    unknowns: ctx.input.unknowns || [],
    requires_human_review: true,
  };
  const artifactResult = await ctx.callTool('artifact.write-draft', {
    kind: 'knowledge_review_packet',
    title: `Knowledge候補 ${ctx.input.knowledge_candidate_id} レビューパケット`,
    content: { ...packet, sources: [] },
  });
  return { ...packet, artifact_id: Number(artifactResult.artifact.id), artifact_code: artifactResult.artifact.artifact_code };
}

async function outcomeMeasurement(ctx) {
  const { rows } = await ctx.client.query(
    `SELECT count(*)::int AS run_count,
            AVG(current_step)::float AS avg_steps,
            AVG(tokens_in + tokens_out)::float AS avg_tokens,
            AVG(cost)::float AS avg_cost
     FROM (
       SELECT r.id, r.current_step, COALESCE(SUM(e.tokens_in),0) AS tokens_in, COALESCE(SUM(e.tokens_out),0) AS tokens_out, COALESCE(SUM(e.cost),0) AS cost
       FROM agent_runs r LEFT JOIN run_events e ON e.run_id = r.id
       WHERE ($1::text IS NULL OR r.agent_id = $1) AND r.status = 'completed'
       GROUP BY r.id
     ) sub`,
    [ctx.input.agent_id || null],
  );
  const row = rows[0];
  const unknowns = row.run_count === 0 ? ['対象期間の実測データがありません'] : [];
  return {
    agent_id: ctx.input.agent_id || null,
    run_count: row.run_count,
    avg_steps: row.avg_steps,
    avg_tokens: row.avg_tokens,
    avg_cost: row.avg_cost,
    human_review_rate: null,
    unknowns,
  };
}

async function sourceNormalize(ctx) {
  const text = sanitizeUntrustedText(String(ctx.input.raw_text || ''), { maxLength: 200000 });
  const reasons = [];
  const inj = scanForInjection(text);
  if (inj.suspicious) reasons.push(`指示文らしき記述を検出（プロンプトインジェクションの疑い: ${inj.matches.join(', ')}）`);
  const secrets = scanForSecrets(text);
  if (secrets.length) reasons.push(`秘密らしき文字列を検出（${secrets.join(', ')}）`);
  if (/\d{2,4}[-‐]\d{2,4}[-‐]\d{4,}/.test(text)) reasons.push('電話番号らしき文字列を検出');
  if (/緯度|経度|[0-9]{1,3}\.[0-9]{3,}[,、]\s*[0-9]{1,3}\.[0-9]{3,}/.test(text)) reasons.push('位置情報らしき文字列を検出');
  const normalized = text.replace(/\s+/g, ' ').trim();
  return { normalized_text: normalized, quarantined: reasons.length > 0, quarantine_reasons: reasons };
}

export const SKILL_HANDLERS = {
  'technology-catalog-search': technologyCatalogSearch,
  'project-case-search': projectCaseSearch,
  'source-citation-verify': sourceCitationVerify,
  'applicability-gap-check': applicabilityGapCheck,
  'technology-comparison': technologyComparison,
  'case-comparison': caseComparison,
  'evidence-backed-draft': evidenceBackedDraft,
  'knowledge-quality-review': knowledgeQualityReview,
  'knowledge-dedup': knowledgeDedup,
  'knowledge-review-packet': knowledgeReviewPacket,
  'outcome-measurement': outcomeMeasurement,
  'source-normalize': sourceNormalize,
};

// =============================================================================
// 第 2 段: 組織責務 Agent 01〜09 が共用する Skill（複数 Agent から再利用。Agent 契約の params で挙動を固定する）
// =============================================================================

async function writeDraft(ctx, kind, title, content) {
  const r = await ctx.callTool('artifact.write-draft', { kind, title, content: { ...content, requires_human_review: true } });
  return { artifact_id: Number(r.artifact.id), artifact_code: r.artifact.artifact_code };
}

async function knowledgeBrief(ctx) {
  const types = Array.isArray(ctx.input.source_types) && ctx.input.source_types.length ? ctx.input.source_types : [null];
  const publicOnly = ctx.input.classification === 'public_only';
  const seen = new Map();
  for (const t of types) {
    const r = await ctx.callTool('knowledge.search-approved', { query: ctx.input.query, sourceType: t, projectId: publicOnly ? null : ctx.run.project_id });
    for (const c of r.candidates || []) if (!seen.has(c.source_record_id)) seen.set(c.source_record_id, c);
  }
  const candidates = [...seen.values()].slice(0, ctx.input.max_results || 10);
  const findings = candidates.map((c) => `『${c.title}』（${c.evidence_type}）: ${String(c.summary || '').slice(0, 160)}`);
  const unknowns = candidates.length ? [] : ['該当する承認済み出典が見つかりません'];
  const content = { findings, unknowns, assumptions: [], sources: candidates.map((c) => ({ source_record_id: c.source_record_id })), candidates };
  const art = await writeDraft(ctx, 'knowledge_brief', `Run ${ctx.run.run_code} 出典要約`, content);
  return { candidates, findings, sources: content.sources, unknowns, requires_human_review: true, ...art };
}

async function planningBrief(ctx) {
  const fallback = { items: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'], assumptions: [] };
  const { data, degraded } = await ctx.structuredComplete({
    instructions:
      `plan_type=${ctx.input.plan_type || 'general'} の観点で、相談内容と先行 Step の事実から論点（items）を列挙してください。` +
      '根拠（based_on の source_record_id）がある論点は status=confirmed、根拠が無く確認が必要な論点は status=unknown にします。数値や工程を推測で確定しないでください。',
    input: { query: ctx.input.query, plan_type: ctx.input.plan_type || 'general', criteria: ctx.input.criteria || [], findings: ctx.input.findings || [], candidates: (ctx.input.candidates || []).slice(0, 10), prior_context: ctx.input.prior_context || [] },
    schema: { type: 'object', required: ['items', 'unknowns', 'assumptions'], additionalProperties: false, properties: {
      items: { type: 'array', maxItems: 20, items: { type: 'object', required: ['title', 'status'], additionalProperties: false, properties: { title: { type: 'string' }, status: { type: 'string', enum: ['confirmed', 'unknown'] }, rationale: { type: 'string' }, based_on: { type: 'array', items: { type: 'integer' } } } } },
      unknowns: { type: 'array', items: { type: 'string' } }, assumptions: { type: 'array', items: { type: 'string' } } } },
    fallbackData: fallback,
  });
  const out = degraded ? fallback : data;
  const known = new Set(((ctx.input.candidates || []).map((c) => Number(c.source_record_id))).concat(((ctx.input.sources || []).map((s) => Number(s.source_record_id)))));
  const items = (out.items || []).map((it) => ({ ...it, based_on: (it.based_on || []).filter((id) => known.has(Number(id))), status: (it.based_on || []).some((id) => known.has(Number(id))) ? it.status : 'unknown' }));
  const unknowns = [...(ctx.input.unknowns || []), ...(out.unknowns || [])];
  const content = { findings: items.filter((i) => i.status === 'confirmed').map((i) => i.title), unknowns: [...unknowns, ...items.filter((i) => i.status === 'unknown').map((i) => `未確認の論点: ${i.title}`)], assumptions: out.assumptions || [], sources: [...known].map((id) => ({ source_record_id: id })), items, plan_type: ctx.input.plan_type || 'general' };
  const art = await writeDraft(ctx, 'planning_brief', `Run ${ctx.run.run_code} 計画論点（${ctx.input.plan_type || 'general'}）`, content);
  return { items, unknowns, assumptions: out.assumptions || [], requires_human_review: true, ...art };
}

async function documentReview(ctx) {
  const text = String(ctx.input.document_text || '').trim();
  if (!text) {
    const content = { issues: [], findings: [], unknowns: ['レビュー対象の文書（document_text）が提供されていません'], assumptions: [], sources: [], requires_expert_review: true };
    const art = await writeDraft(ctx, 'document_review', `Run ${ctx.run.run_code} 文書レビュー（文書なし）`, content);
    return { issues: [], unknowns: content.unknowns, requires_human_review: true, requires_expert_review: true, ...art };
  }
  const fallback = { issues: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'] };
  const { data, degraded } = await ctx.structuredComplete({
    instructions: '文書を観点（criteria）ごとにレビューし、指摘（finding）・重大度（high/medium/low/unknown）・該当箇所の引用（quote、文書からの抜粋）を返してください。文書に書かれていないことは指摘せず、判断できない点は unknowns に列挙します。合否は判定しません。',
    input: { query: ctx.input.query, criteria: ctx.input.criteria || [], document: text.slice(0, 20000) },
    schema: { type: 'object', required: ['issues', 'unknowns'], additionalProperties: false, properties: {
      issues: { type: 'array', maxItems: 30, items: { type: 'object', required: ['criterion', 'finding', 'severity'], additionalProperties: false, properties: { criterion: { type: 'string' }, finding: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] }, quote: { type: 'string' } } } },
      unknowns: { type: 'array', items: { type: 'string' } } } },
    fallbackData: fallback,
  });
  const out = degraded ? fallback : data;
  const content = { issues: out.issues, findings: out.issues.map((i) => `[${i.severity}] ${i.criterion}: ${i.finding}`), unknowns: [...(ctx.input.unknowns || []), ...out.unknowns], assumptions: [], sources: [], requires_expert_review: true };
  const art = await writeDraft(ctx, 'document_review', `Run ${ctx.run.run_code} 文書レビュー`, content);
  return { issues: out.issues, unknowns: content.unknowns, requires_human_review: true, requires_expert_review: true, ...art };
}

async function riskAssessment(ctx) {
  const fallback = { risk_items: [], unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'] };
  const { data, degraded } = await ctx.structuredComplete({
    instructions: `domain=${ctx.input.domain || 'general'} の観点で、相談内容と文脈から危険源（hazard）・結果（consequence）・可能性・重大性・対策候補（controls）・根拠（basis）を列挙してください。根拠が無い項目の可能性・重大性は unknown にします。リスクの受容や承認は判断しません。`,
    input: { query: ctx.input.query, domain: ctx.input.domain || 'general', context: ctx.input.context || '', findings: ctx.input.findings || [], prior_context: ctx.input.prior_context || [] },
    schema: { type: 'object', required: ['risk_items', 'unknowns'], additionalProperties: false, properties: {
      risk_items: { type: 'array', maxItems: 20, items: { type: 'object', required: ['hazard', 'consequence', 'likelihood', 'severity'], additionalProperties: false, properties: { hazard: { type: 'string' }, consequence: { type: 'string' }, likelihood: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] }, severity: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] }, controls: { type: 'array', items: { type: 'string' } }, basis: { type: 'string' } } } },
      unknowns: { type: 'array', items: { type: 'string' } } } },
    fallbackData: fallback,
  });
  const out = degraded ? fallback : data;
  const content = { risk_items: out.risk_items, findings: out.risk_items.map((r) => `${r.hazard} → ${r.consequence}（可能性 ${r.likelihood} / 重大性 ${r.severity}）`), unknowns: [...(ctx.input.unknowns || []), ...out.unknowns], assumptions: [], sources: [], requires_expert_review: true, domain: ctx.input.domain || 'general' };
  const art = await writeDraft(ctx, 'risk_assessment', `Run ${ctx.run.run_code} リスク整理（${ctx.input.domain || 'general'}）`, content);
  return { risk_items: out.risk_items, unknowns: content.unknowns, requires_human_review: true, requires_expert_review: true, ...art };
}

async function decisionLogDraft(ctx) {
  const considerations = [...(ctx.input.findings || []), ...((ctx.input.items || []).map((i) => `${i.title}（${i.status}）`)), ...((ctx.input.kpis || []).map((k) => `${k.name}: ${k.value}${k.unit ? ' ' + k.unit : ''}`))].slice(0, 30);
  const content = { decision_status: 'undecided', topic: ctx.input.query, options: ctx.input.options || [], considerations, unknowns: ctx.input.unknowns || [], approvers_required: ['人間の責任者（該当ロール）', '正式承認は desknet\'s NEO Workflow'], findings: considerations, assumptions: ctx.input.assumptions || [], sources: ctx.input.sources || [] };
  const art = await writeDraft(ctx, 'decision_log', `Run ${ctx.run.run_code} 意思決定ログ（未決定）`, content);
  return { decision_status: 'undecided', topic: ctx.input.query, options: content.options, considerations, unknowns: content.unknowns, approvers_required: content.approvers_required, requires_human_review: true, ...art };
}

async function kpiReview(ctx) {
  const q = async (sql) => (await ctx.client.query(sql)).rows[0];
  const runs = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed FROM agent_runs WHERE created_at >= date_trunc('month', now())`);
  const cost = await q(`SELECT COALESCE(SUM(spent_usd),0)::float AS cost FROM budget_reservations WHERE created_at >= date_trunc('month', now())`);
  const arts = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE review_state = 'reviewed')::int AS reviewed FROM artifacts`);
  const apr = await q(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending FROM approval_requests`);
  const src = await q(`SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'pending')::int AS pending FROM source_records`);
  const kn = await q(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'promoted')::int AS promoted FROM knowledge_candidates`);
  const period = '当月';
  const kpis = [
    { name: '業務Agent Run 件数', value: runs.total, unit: '件', source: 'agent_runs', period },
    { name: '業務Agent 完走率', value: runs.total ? Math.round((runs.completed / runs.total) * 100) : 0, unit: '%', source: 'agent_runs', period },
    { name: 'LLM 費用', value: Number(Number(cost.cost || 0).toFixed(4)), unit: 'USD', source: 'budget_reservations', period },
    { name: '草案レビュー率', value: arts.total ? Math.round((arts.reviewed / arts.total) * 100) : 0, unit: '%', source: 'artifacts', period: '累計' },
    { name: '承認待ち', value: apr.pending, unit: '件', source: 'approval_requests', period: '現在' },
    { name: '承認済み出典', value: src.approved, unit: '件', source: 'source_records', period: '現在' },
    { name: 'Knowledge 候補（pending / promoted）', value: `${kn.pending || 0} / ${kn.promoted || 0}`, unit: '件', source: 'knowledge_candidates', period: '現在' },
  ];
  const unknowns = ['受注・売上・利益・工事原価などの業務 KPI は本システムに未登録のため提示できません（AppSuite 連携の仕様確認後）'];
  const content = { kpis, findings: kpis.map((k) => `${k.name}: ${k.value}${k.unit ? ' ' + k.unit : ''}（${k.period}）`), unknowns, assumptions: [], sources: [] };
  const art = await writeDraft(ctx, 'kpi_review', `Run ${ctx.run.run_code} KPI レビュー`, content);
  return { kpis, unknowns, requires_human_review: true, ...art };
}

async function sodCheck(ctx) {
  const q = async (sql, p = []) => (await ctx.client.query(sql, p)).rows[0];
  const selfApprovalAttempts = await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'approval.self_review_denied'`);
  const adminProxy = await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'approval.approved' AND (detail->>'admin_proxy') = 'true'`);
  const selfReviewSources = await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'source.approve' AND (detail->>'selfReviewException') = 'true'`);
  const unverifiedRefs = await q(`SELECT count(*)::int AS n FROM approval_requests WHERE external_ref IS NOT NULL AND external_ref_status <> 'verified'`);
  const pendingOld = await q(`SELECT count(*)::int AS n FROM approval_requests WHERE status = 'pending' AND created_at < now() - interval '7 days'`);
  const approvers = await q(`SELECT count(*)::int AS n FROM users WHERE active AND role IN ('Approver','Administrator')`);
  const checks = [
    { name: '自己承認の試行（拒否済み）', count: selfApprovalAttempts.n }, { name: 'Administrator の代理承認', count: adminProxy.n },
    { name: '出典の self-review 例外承認', count: selfReviewSources.n }, { name: '未検証の正式承認参照（NEO）', count: unverifiedRefs.n },
    { name: '7 日以上未判定の承認', count: pendingOld.n }, { name: '有効な Approver / Administrator', count: approvers.n },
  ];
  const findings = [];
  if (selfReviewSources.n > 0) findings.push(`出典承認で取り込み者本人の例外承認が ${selfReviewSources.n} 件あります（2 人目の Approver 配置で解消）`);
  if (approvers.n < 2) findings.push('Approver / Administrator が 1 名のため職務分離が例外運用になっています');
  if (unverifiedRefs.n > 0) findings.push(`NEO の承認番号が控えられているが未検証のものが ${unverifiedRefs.n} 件あります`);
  if (pendingOld.n > 0) findings.push(`7 日以上未判定の承認が ${pendingOld.n} 件あります`);
  const content = { findings, checks, unknowns: ctx.input.approval_id ? [] : ['特定の承認申請ではなく全体の集計です'], assumptions: [], sources: [] };
  const art = await writeDraft(ctx, 'sod_check', `Run ${ctx.run.run_code} 職務分離チェック`, content);
  return { findings, checks, unknowns: content.unknowns, requires_human_review: true, ...art };
}

async function quantityConsistencyCheck(ctx) {
  const text = String(ctx.input.quantities_text || '').trim();
  if (!text) {
    const content = { parsed: [], issues: [], findings: [], unknowns: ['数量・金額の行（quantities_text）が提供されていません'], assumptions: [], sources: [] };
    const art = await writeDraft(ctx, 'quantity_check', `Run ${ctx.run.run_code} 数量整合（入力なし）`, content);
    return { parsed: [], issues: [], unknowns: content.unknowns, requires_human_review: true, ...art };
  }
  const parsed = []; const unknowns = []; const issues = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    // 単位は「m3」「m2」「t」「個」「千円」など。先頭が数字でない連続文字列を単位とみなす
    const m = /^(.+?)[:：]\s*([-+]?[\d,]+(?:\.\d+)?)\s*([^\s\d][^\s]*)?\s*$/.exec(line);
    if (!m) { unknowns.push(`解析できない行: ${line.slice(0, 60)}`); continue; }
    parsed.push({ label: m[1].trim(), value: Number(m[2].replace(/,/g, '')), unit: (m[3] || '').trim() || '(単位なし)' });
  }
  const byLabel = new Map();
  for (const p of parsed) { if (!byLabel.has(p.label)) byLabel.set(p.label, new Set()); byLabel.get(p.label).add(p.unit); }
  for (const [label, units] of byLabel) if (units.size > 1) issues.push(`「${label}」の単位が混在しています（${[...units].join(', ')}）`);
  for (const p of parsed) if (p.unit === '(単位なし)') issues.push(`「${p.label}」に単位がありません`);
  const totals = parsed.filter((p) => /合計|計|total/i.test(p.label));
  for (const t of totals) {
    const items = parsed.filter((p) => p !== t && p.unit === t.unit && !/合計|計|total/i.test(p.label));
    const sum = items.reduce((n, p) => n + p.value, 0);
    if (items.length && Math.abs(sum - t.value) > 1e-6) issues.push(`「${t.label}」${t.value} ${t.unit} は同じ単位の明細の和 ${sum} と一致しません`);
  }
  const content = { parsed, issues, findings: issues, unknowns, assumptions: [], sources: [] };
  const art = await writeDraft(ctx, 'quantity_check', `Run ${ctx.run.run_code} 数量整合`, content);
  return { parsed, issues, unknowns, requires_human_review: true, ...art };
}

async function regionalContext(ctx) {
  const { loadUnifiedCatalog } = await import('../catalog.js');
  const cat = loadUnifiedCatalog();
  const branch = String(ctx.input.branch || '').trim();
  const org = cat.organizations.find((o) => o.code === '07');
  const classification = ctx.input.allowed_classification || 'authorized';
  const unknowns = ['本システムには支店別の案件・KPI データが登録されていないため、地域固有の実績は承認済み出典（公開資料）の範囲に限られます'];
  if (!branch && !ctx.input.customer) unknowns.push('支店・地域または顧客の指定がありません');
  return {
    region: branch || '（未指定）', customer: String(ctx.input.customer || ''), classification,
    scope_note: `${org ? org.org : '支店・営業所'} の文脈。利用できる出典の分類: ${classification === 'public_only' ? '公開資料のみ（社内非公開資料は使わない）' : '公開資料と権限のある案件資料'}`,
    unknowns,
  };
}

// =============================================================================
// 第 3 段: 土木専門 Agent が共用する決定的 Skill（推測しない。無いものは未確定として登録する）
// =============================================================================

/** 専門分野ごとの必要条件が相談文・先行資料に書かれているかを照合する（D-015: 条件が無ければ未確定）。 */
async function conditionGapRegister(ctx) {
  const required = Array.isArray(ctx.input.required_conditions) ? ctx.input.required_conditions : [];
  const corpus = [String(ctx.input.query || ''), String(ctx.input.technical_text || ''), String(ctx.input.quantities_text || ''), String(ctx.input.document_text || '')];
  for (const p of Array.isArray(ctx.input.prior_context) ? ctx.input.prior_context : []) corpus.push(...(p.findings || []).map(String));
  const text = corpus.join('\n');
  // 「N値」「地下水位」のような条件名と、その語幹（先頭 2 文字以上）のどちらかが本文にあれば「記載あり」。「不明」「未定」と併記されていれば未確定
  const present = []; const missing = [];
  for (const c of required) {
    const idx = text.indexOf(c);
    // 条件名の直後（同じ文の 12 文字以内）に「不明」等があれば未確定。次の文には波及させない
    const tail = idx >= 0 ? text.slice(idx + c.length, idx + c.length + 12).split(/[。\n]/)[0] : '';
    const written = idx >= 0 && !/不明|未定|未確定|未取得|わからない/.test(tail);
    (written ? present : missing).push(c);
  }
  const unknowns = missing.map((c) => `未確定条件: ${c}（相談文・先行資料に記載がないため推測しない）`);
  if (required.length === 0) unknowns.push('required_conditions が Agent 契約に無いため、条件の充足を判定できません');
  const content = { findings: present.map((c) => `条件「${c}」の記載あり`), unknowns, assumptions: [], sources: [], present_conditions: present, missing_conditions: missing };
  const art = await writeDraft(ctx, 'condition_gap_register', `Run ${ctx.run.run_code} 未確定条件の登録`, content);
  return { present_conditions: present, missing_conditions: missing, unknowns, requires_human_review: true, ...art };
}

const UNIT_RE = /(?<![A-Za-z])(mm|cm|m3|m2|m|km|kN|N|tf|t|kPa|MPa|kg|ft|in)(?![A-Za-z])/g;
const CRS_RE = /(JGD2011|JGD2000|Tokyo\s?Datum|日本測地系|世界測地系|WGS\s?84|平面直角座標系?\s?第?\s?[0-9IVXⅠ-Ⅻ]+系?|UTM\s?\d*)/g;
const DATUM_RE = /(T\.?P\.?|D\.?L\.?|C\.?D\.?L\.?|L\.?W\.?L\.?|H\.?W\.?L\.?|A\.?P\.?|K\.?P\.?)(?=[+\-±\s\d])/g;
const UNIT_FAMILY = { length: ['mm', 'cm', 'm', 'km', 'ft', 'in'], force: ['kN', 'N', 'tf', 't', 'kg'], pressure: ['kPa', 'MPa'] };
const IMPERIAL = new Set(['ft', 'in']); const GRAVIMETRIC = new Set(['tf', 't', 'kg']); const SI_FORCE = new Set(['kN', 'N']);

/** 数値・単位・座標系・基準面の整合（D-018 / X-013 / X-014）。抽出できなければ不明として明示し、推定しない。 */
async function engineeringConsistencyCheck(ctx) {
  const corpus = [String(ctx.input.technical_text || ''), String(ctx.input.quantities_text || ''), String(ctx.input.document_text || '')];
  for (const p of Array.isArray(ctx.input.prior_context) ? ctx.input.prior_context : []) corpus.push(...(p.findings || []).map(String));
  const text = corpus.join('\n');
  const units = [...new Set([...text.matchAll(UNIT_RE)].map((m) => m[1]))];
  const crs = [...new Set([...text.matchAll(CRS_RE)].map((m) => m[1].replace(/\s+/g, '')))];
  const datums = [...new Set([...text.matchAll(DATUM_RE)].map((m) => m[1].replace(/\./g, '').toUpperCase()))];
  const issues = []; const unknowns = [];
  if (!text.trim()) unknowns.push('数値・座標を含む本文（technical_text 等）が無いため、単位・座標系・基準面の整合を判定できません');
  const lengthUnits = units.filter((u) => UNIT_FAMILY.length.includes(u));
  if (lengthUnits.some((u) => IMPERIAL.has(u)) && lengthUnits.some((u) => !IMPERIAL.has(u))) issues.push(`長さの単位系が混在しています（${lengthUnits.join(', ')}）: SI とヤード・ポンド法を同一資料で併用`);
  const forceUnits = units.filter((u) => UNIT_FAMILY.force.includes(u));
  if (forceUnits.some((u) => GRAVIMETRIC.has(u)) && forceUnits.some((u) => SI_FORCE.has(u))) issues.push(`力・荷重の単位系が混在しています（${forceUnits.join(', ')}）: SI（kN）と重力単位系（tf 等）の併用`);
  if (crs.length > 1) issues.push(`座標系が複数現れます（${crs.join(', ')}）: 測地系の不一致は位置ずれの原因になるため統一を確認`);
  if (datums.length > 1) issues.push(`基準面が複数現れます（${datums.join(', ')}）: T.P. / D.L. / C.D.L. の換算値の明示が必要`);
  const content = { findings: [...(units.length ? [`単位: ${units.join(', ')}`] : []), ...(crs.length ? [`座標系: ${crs.join(', ')}`] : []), ...(datums.length ? [`基準面: ${datums.join(', ')}`] : []), ...issues], unknowns, assumptions: [], sources: [], issues, units_found: units, coordinate_systems: crs, datums };
  const art = await writeDraft(ctx, 'engineering_consistency', `Run ${ctx.run.run_code} 数値・単位・座標系の整合`, content);
  return { units_found: units, coordinate_systems: crs, datums, issues, unknowns, requires_human_review: true, ...art };
}

/** 基準・指針の版と発行元を承認済み出典から確認し、旧版・新版の混在を検出する（D-019 / G-016）。基準本文は判断に使わない。 */
async function standardReferenceCheck(ctx) {
  const types = Array.isArray(ctx.input.standard_source_types) && ctx.input.standard_source_types.length ? ctx.input.standard_source_types : ['standard', 'technology_catalog'];
  const references = []; const seen = new Set();
  for (const t of types) {
    const r = await ctx.callTool('knowledge.search-approved', { query: ctx.input.query, sourceType: t, projectId: ctx.run.project_id, withMeta: true });
    for (const c of r.candidates || []) {
      if (seen.has(c.source_record_id)) continue; seen.add(c.source_record_id);
      references.push({ source_record_id: c.source_record_id, title: c.title, source_type: c.source_type || t, version: c.version ?? null, published_at: c.published_at ?? null, effective_to: c.effective_to ?? null, canonical_url: c.canonical_url ?? null });
    }
  }
  const issues = []; const unknowns = [];
  const byTitle = new Map();
  for (const ref of references) { const k = ref.title.replace(/\s+/g, ''); if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(ref); }
  for (const [, refs] of byTitle) if (refs.length > 1) issues.push(`「${refs[0].title}」に複数の版があります（version ${refs.map((r) => r.version).join(', ')}）: 適用する版を明示`);
  const soon = new Date(); soon.setDate(soon.getDate() + 90);
  for (const ref of references) if (ref.effective_to && new Date(ref.effective_to) <= soon) issues.push(`「${ref.title}」の有効期限（${ref.effective_to}）が 90 日以内です`);
  if (!references.some((r) => r.source_type === 'standard')) unknowns.push('社内基準（source_type=standard）は未登録のため、基準への適合は判定できません（B-10: 社内基準資料の提供待ち）');
  if (references.length === 0) unknowns.push('相談内容に対応する承認済みの基準・技術資料が見つかりません');
  const content = { findings: references.map((r) => `${r.title}（${r.source_type} / version ${r.version ?? '—'} / 発行 ${r.published_at ?? '不明'}）`), unknowns, assumptions: [], sources: references.map((r) => ({ source_record_id: r.source_record_id, locator: `version ${r.version ?? '—'}` })), issues, references };
  const art = await writeDraft(ctx, 'standard_reference', `Run ${ctx.run.run_code} 根拠基準の版確認`, content);
  return { references, issues, unknowns, requires_human_review: true, ...art };
}

// =============================================================================
// 第 4 段: Cross Review（独立レビュー）。機械検査（決定的）+ Independent Review 分類のモデルによる横断レビュー。判定は機械検査より緩められない
// =============================================================================

const VERDICT_RANK = { PASS: 0, CONDITIONAL: 1, FAIL: 2 };
const QUANTITY_RE = /([^\s、。，,:：\d]{1,20})\s*[:：=は]?\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*(mm|cm|m3|m2|km|m|kN|tf|kPa|MPa|kg|t)(?![A-Za-z])/g;

/** 機械検査: Agent 間の数値矛盾、単位・座標系・基準面の混在、根拠の無い事実。 */
export function machineCrossCheck(priorContext) {
  const ctxs = Array.isArray(priorContext) ? priorContext : [];
  const contradictions = []; const unsupported = [];
  const quantities = new Map(); // key: label|unit → [{ agent, value }]
  for (const c of ctxs) {
    const agent = String(c.agent_id || '?');
    for (const f of c.findings || []) {
      for (const m of String(f).matchAll(QUANTITY_RE)) {
        const key = `${m[1].trim()}|${m[3]}`;
        if (!quantities.has(key)) quantities.set(key, []);
        quantities.get(key).push({ agent, value: Number(m[2].replace(/,/g, '')) });
      }
    }
    if ((c.findings || []).length > 0 && (c.sources || []).length === 0) unsupported.push(`[${agent}] ${c.artifact_code || ''} の事実 ${(c.findings || []).length} 件に根拠（sources）が無い`);
  }
  for (const [key, vals] of quantities) {
    const agents = new Set(vals.map((v) => v.agent)); const values = new Set(vals.map((v) => v.value));
    if (agents.size > 1 && values.size > 1) {
      const [label, unit] = key.split('|');
      contradictions.push({ type: 'numbers', detail: `「${label}」の値が Agent 間で異なる: ${vals.map((v) => `${v.agent}=${v.value} ${unit}`).join(' / ')}`, agents: [...agents] });
    }
  }
  const text = ctxs.flatMap((c) => c.findings || []).map(String).join('\n');
  const units = [...new Set([...text.matchAll(UNIT_RE)].map((m) => m[1]))];
  const crs = [...new Set([...text.matchAll(CRS_RE)].map((m) => m[1].replace(/\s+/g, '')))];
  const datums = [...new Set([...text.matchAll(DATUM_RE)].map((m) => m[1].replace(/\./g, '').toUpperCase()))];
  const agentsAll = [...new Set(ctxs.map((c) => String(c.agent_id || '?')))];
  if (units.some((u) => IMPERIAL.has(u)) && units.some((u) => UNIT_FAMILY.length.includes(u) && !IMPERIAL.has(u))) contradictions.push({ type: 'units', detail: `長さの単位系が混在（${units.join(', ')}）`, agents: agentsAll });
  if (units.some((u) => GRAVIMETRIC.has(u)) && units.some((u) => SI_FORCE.has(u))) contradictions.push({ type: 'units', detail: `力・荷重の単位系が混在（${units.join(', ')}）`, agents: agentsAll });
  if (crs.length > 1) contradictions.push({ type: 'units', detail: `座標系が複数（${crs.join(', ')}）`, agents: agentsAll });
  if (datums.length > 1) contradictions.push({ type: 'units', detail: `基準面が複数（${datums.join(', ')}）`, agents: agentsAll });
  let verdict = 'PASS';
  if (contradictions.some((c) => c.type === 'numbers')) verdict = 'FAIL';
  else if (contradictions.length > 0 || unsupported.length > 0) verdict = 'CONDITIONAL';
  return { contradictions, unsupported, verdict };
}

const CROSS_REVIEW_SCHEMA = { type: 'object', required: ['verdict', 'confidence', 'contradictions', 'unsupported_claims', 'minority_opinions', 'unknowns', 'reasons'], additionalProperties: false, properties: {
  verdict: { type: 'string', enum: ['PASS', 'CONDITIONAL', 'FAIL'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
  contradictions: { type: 'array', maxItems: 20, items: { type: 'object', required: ['type', 'detail', 'agents'], additionalProperties: false, properties: { type: { type: 'string', enum: ['numbers', 'units', 'assumptions', 'sources', 'risk', 'other'] }, detail: { type: 'string', maxLength: 300 }, agents: { type: 'array', items: { type: 'string' }, maxItems: 6 } } } },
  unsupported_claims: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } }, minority_opinions: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 } },
  unknowns: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } }, reasons: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 } } } };

async function crossReview(ctx) {
  const prior = Array.isArray(ctx.input.prior_context) ? ctx.input.prior_context : [];
  const machine = machineCrossCheck(prior);
  let verdict = machine.verdict; let confidence = 0.3; let source = 'machine_only';
  let contradictions = [...machine.contradictions]; let unsupported = [...machine.unsupported]; let minority = []; let unknowns = []; let reasons = [];
  if (prior.length === 0) {
    verdict = 'CONDITIONAL'; confidence = 0; unknowns.push('レビュー対象の成果が無いため判定できません');
  } else {
    // K-002 / K-017: 一次 Agent とは別のモデル分類（Independent Review）。使えなければ機械検査だけで判定し、PASS にはしない
    try {
      const { data, degraded } = await ctx.structuredComplete({
        instructions: 'あなたは一次 Agent とは独立した技術レビュアーです。複数 Agent の成果（事実・不明点・前提・出典 ID）を横断し、数値・単位・前提条件・出典・リスク評価の矛盾、根拠のない主張、少数意見（異論。消さずに残す）、未確認事項を列挙してください。' +
          '同じ内容をそのまま追認せず、必ず疑って確認します。verdict は矛盾があれば FAIL、確認が必要なら CONDITIONAL、問題が見当たらなければ PASS。confidence は判断の確からしさ（0〜1）。技術的な合否や設計判断はしません。',
        input: { query: ctx.input.query, agents: prior.map((p) => ({ agent_id: p.agent_id, artifact_code: p.artifact_code, findings: (p.findings || []).slice(0, 15), unknowns: (p.unknowns || []).slice(0, 10), assumptions: (p.assumptions || []).slice(0, 10), source_ids: (p.sources || []).map((s) => s.source_record_id).filter(Boolean) })), machine_check: machine },
        schema: CROSS_REVIEW_SCHEMA, fallbackData: { verdict: machine.verdict === 'PASS' ? 'CONDITIONAL' : machine.verdict, confidence: 0.3, contradictions: [], unsupported_claims: [], minority_opinions: [], unknowns: ['独立レビュー（LLM）の出力を採用できず機械検査のみ'], reasons: [] },
      });
      if (!degraded) {
        source = 'llm'; confidence = data.confidence; minority = data.minority_opinions; unknowns = data.unknowns; reasons = data.reasons;
        contradictions = [...contradictions, ...data.contradictions]; unsupported = [...unsupported, ...data.unsupported_claims];
        // 判定の強制: LLM は機械検査より緩められない
        verdict = VERDICT_RANK[data.verdict] >= VERDICT_RANK[machine.verdict] ? data.verdict : machine.verdict;
        if (verdict !== data.verdict) reasons.push(`LLM の判定 ${data.verdict} を機械検査の ${machine.verdict} へ引き上げ`);
      } else {
        unknowns.push('独立レビュー（LLM）の出力を採用できなかったため機械検査のみ');
        if (verdict === 'PASS') verdict = 'CONDITIONAL';
      }
    } catch (err) {
      if (!(err instanceof ProviderNotConfiguredError)) throw err;
      unknowns.push('独立レビュー（LLM）が未設定のため機械検査のみ。PASS とは判定しない');
      if (verdict === 'PASS') verdict = 'CONDITIONAL';
    }
  }
  const humanForced = verdict === 'FAIL';
  const findings = [`判定 ${verdict}（confidence ${confidence}、${source === 'llm' ? '独立レビュー + 機械検査' : '機械検査のみ'}）`, ...contradictions.map((c) => `[${c.type}] ${c.detail}`), ...unsupported.map((u) => `[根拠なし] ${u}`)];
  const content = { verdict, confidence, contradictions, unsupported_claims: unsupported, minority_opinions: minority, reasons, review_source: source, human_review_forced: humanForced,
    findings, unknowns, assumptions: [], sources: [], reviewed_agents: prior.map((p) => ({ agent_id: p.agent_id, artifact_code: p.artifact_code })) };
  const art = await writeDraft(ctx, 'cross_review', `Run ${ctx.run.run_code} 相互レビュー（${verdict}）`, content);
  return { verdict, confidence, contradictions, unsupported_claims: unsupported, minority_opinions: minority, unknowns, review_source: source, human_review_forced: humanForced, requires_human_review: true, ...art };
}

Object.assign(SKILL_HANDLERS, {
  'cross-review': crossReview,
  'condition-gap-register': conditionGapRegister,
  'engineering-consistency-check': engineeringConsistencyCheck,
  'standard-reference-check': standardReferenceCheck,
  'knowledge-brief': knowledgeBrief,
  'planning-brief': planningBrief,
  'document-review': documentReview,
  'risk-assessment': riskAssessment,
  'decision-log-draft': decisionLogDraft,
  'kpi-review': kpiReview,
  'sod-check': sodCheck,
  'quantity-consistency-check': quantityConsistencyCheck,
  'regional-context': regionalContext,
});
