/**
 * 各SkillのJS実装。SKILL.md/execution.yamlが「契約」（目的・入出力Schema・許可Tool）を定義し、
 * ここでの実装がその契約を満たす（workflow-engineが呼び出し前後にJSON Schema検証を行う）。
 *
 * 各ハンドラのシグネチャ: async (ctx) => output
 * ctx = { client, run, skillVersion, input, callTool, structuredComplete, validateCitations, nextSeq }
 */

import { sanitizeUntrustedText, scanForInjection, scanForSecrets } from '../prompt-guard.js';

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

Object.assign(SKILL_HANDLERS, {
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
