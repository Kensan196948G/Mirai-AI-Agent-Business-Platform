/**
 * 各SkillのJS実装。SKILL.md/execution.yamlが「契約」（目的・入出力Schema・許可Tool）を定義し、
 * ここでの実装がその契約を満たす（workflow-engineが呼び出し前後にJSON Schema検証を行う）。
 *
 * 各ハンドラのシグネチャ: async (ctx) => output
 * ctx = { client, run, skillVersion, input, callTool, structuredComplete, validateCitations, nextSeq }
 */

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

  const fallback = {
    findings: [], sources: valid.map((id) => ({ source_record_id: id })),
    unknowns: ['LLM出力の検証に失敗したため保留（人手確認が必要）'], assumptions: [], requires_human_review: true,
  };

  let output = fallback;
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

  return { ...finalOutput, artifact_id: artifactResult.artifact.id, artifact_code: artifactResult.artifact.artifact_code };
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
  const searchResult = await ctx.callTool('knowledge.search-approved', { query: ctx.input.title, sourceType: null, projectId: null });
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
  return { ...packet, artifact_id: artifactResult.artifact.id, artifact_code: artifactResult.artifact.artifact_code };
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
  const text = String(ctx.input.raw_text || '');
  const reasons = [];
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
