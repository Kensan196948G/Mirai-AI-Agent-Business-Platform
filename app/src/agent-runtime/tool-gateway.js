/**
 * Tool Gateway: 登録済み・型付きToolのみを実行する。任意のShell/SQL/URL取得/動的JavaScriptは
 * LLMへ一切与えない。呼び出しは常に authorizeToolCall を経由し、許可・拒否どちらも
 * run_events へ記録する。
 */
import { technicalRiskPolicy } from './skill-loader.js';
import { authorizeToolCall, authorizeSourceAccess, PolicyDeniedError } from './policy-engine.js';
import { extractSearchTokens } from '../lib/search-tokens.js';
import { appendEvent } from './job-store.js';
import { nextArtifactCode } from '../lib/codes.js';
import { contentHash, inputHash, findPreviousArtifact } from '../lib/artifact-lineage.js';
import { enforceOutputPolicy, collectSourceIds } from './prompt-guard.js';

/**
 * 承認済み出典の検索（B-12）。
 * 相談文から日本語対応の検索語を取り出し（lib/search-tokens.js）、title / summary / content_text への
 * 部分一致（pg_trgm GIN index）で候補を集め、一致した語数と title の類似度で並べる。
 * 有効期限切れ（effective_to < 今日）と未承認は除外する。
 */
async function toolKnowledgeSearchApproved(client, { query, sourceType, projectId, withMeta = false }) {
  const tokens = extractSearchTokens(query);
  if (tokens.length === 0) return { candidates: [] };

  // 一致点: title=3 / summary=2 / content_text=1（語ごとの最大）。
  // 本文中の一般語 1 語だけの一致（例: 架空の技術名を尋ねた相談文の「存在」）で候補を返さないよう、
  // 語が 2 つ以上ある相談文では合計 2 点以上（title か summary の一致、または本文で 2 語以上）を要求する。
  const minScore = tokens.length >= 2 ? 2 : 1;
  const params = [sourceType || null, projectId || null, String(query || ''), minScore, ...tokens.map((t) => `%${t}%`)];
  const hitExprs = tokens.map((_, i) => `(CASE WHEN title ILIKE $${i + 5} THEN 3 WHEN summary ILIKE $${i + 5} THEN 2 WHEN content_text ILIKE $${i + 5} THEN 1 ELSE 0 END)`);
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT id, title, summary, evidence_type, source_type, version, published_at, effective_from, effective_to, canonical_url,
              (${hitExprs.join(' + ')}) AS hit_score,
              similarity(title, $3::text) AS title_sim
       FROM source_records
       WHERE status = 'approved'
         AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         AND (classification = 'public' OR ($2::bigint IS NOT NULL AND project_scope = $2))
         AND ($1::text IS NULL OR source_type = $1)
         AND (${tokens.map((_, i) => `title ILIKE $${i + 5} OR summary ILIKE $${i + 5} OR content_text ILIKE $${i + 5}`).join(' OR ')})
     ) scored
     WHERE hit_score >= $4
     ORDER BY hit_score DESC, title_sim DESC, id
     LIMIT 10`,
    params,
  );
  // pg は BIGINT 列を文字列で返すため、JSON Schema（type: integer）検証に通るよう Number() で正規化する。
  // withMeta: 版・発行日・有効期限・発行元 URL を付ける（standard-reference-check が基準の版を追跡するために使う。既定では従来どおり）
  return { candidates: rows.map((r) => ({ source_record_id: Number(r.id), title: r.title, summary: r.summary, evidence_type: r.evidence_type,
    ...(withMeta ? { source_type: r.source_type, version: r.version, published_at: r.published_at ? String(r.published_at).slice(0, 10) : null, effective_to: r.effective_to ? String(r.effective_to).slice(0, 10) : null, canonical_url: r.canonical_url || null } : {}) })) };
}

/** 既存の昇格済みKnowledge（knowledge_candidates.status='promoted'）を検索する。source_recordsとは別物。 */
async function toolKnowledgeSearchPromoted(client, { query }) {
  const tokens = extractSearchTokens(query);
  if (tokens.length === 0) return { candidates: [] };

  const likeClauses = tokens.map((_, i) => `(title ILIKE $${i + 1} OR summary ILIKE $${i + 1})`).join(' OR ');
  const { rows } = await client.query(
    `SELECT id, title, summary FROM knowledge_candidates WHERE status = 'promoted' AND (${likeClauses}) ORDER BY id LIMIT 10`,
    tokens.map((t) => `%${t}%`),
  );
  return { candidates: rows.map((r) => ({ knowledge_id: Number(r.id), title: r.title, summary: r.summary })) };
}

async function toolSourceReadApprovedSnapshot(client, { run, sourceRecordId }) {
  const { rows } = await client.query(`SELECT * FROM source_records WHERE id = $1`, [sourceRecordId]);
  if (rows.length === 0) throw new PolicyDeniedError(`source_record ${sourceRecordId} が見つかりません`);
  authorizeSourceAccess({ run, sourceRecord: rows[0] });
  return { source: rows[0] };
}

/**
 * 草案の保存。同一 Run・同一 kind の草案が既にあれば新規作成せず内容を更新する（冪等）。
 * Step の再試行（出力検証失敗・Worker再起動等）で同じ草案が重複作成されるのを防ぐ。
 * レビュー済み（review_state='reviewed'）の草案は上書きしない。
 */
/** この Run で実際に検索・検証された出典 ID（先行 Step の出力から集める）。草案の根拠はこの範囲に限定する。 */
async function allowedSourceIdsForRun(client, runId) {
  const { rows } = await client.query(`SELECT detail FROM run_events WHERE run_id = $1 AND type = 'step_completed'`, [runId]);
  const acc = new Set();
  for (const r of rows) collectSourceIds(r.detail, acc);
  return acc;
}

async function toolArtifactWriteDraft(client, { run, kind, title, content: rawContent }) {
  const risk = technicalRiskPolicy(run.technical_risk_class);
  // Prompt Injection 対策: 草案は常に人手確認、根拠は Run 内で検証済みの出典のみ、秘密らしき記述と指示文は除去
  // 先行 Step の出力が無い Run（検索を経ていない）では範囲を判定できないため、根拠の制限は先行 Step がある場合にだけ適用する
  const allowed = run.id ? await allowedSourceIdsForRun(client, run.id) : null;
  const guarded = enforceOutputPolicy(rawContent, { requireHumanReview: true, allowedSourceIds: allowed && allowed.size > 0 ? allowed : null });
  const content = guarded.output;
  // 技術リスク区分を成果物本文にも残す（T3 以上: 専門技術者レビュー必須、T5/T6: AI 単独では完了しない）
  if (risk.technical_risk_class) Object.assign(content, { technical_risk_class: risk.technical_risk_class, expert_review_required: risk.expert_review_required, ai_completion_prohibited: risk.ai_completion_prohibited });
  if (guarded.enforced.length > 0 && run.id) {
    await appendEvent(client, run.id, { type: 'policy_enforced', toolName: 'artifact.write-draft', status: 'ok', detail: { rules: guarded.enforced } });
  }
  const { rows: existing } = await client.query(
    `SELECT id, artifact_code, kind, title, review_state, content, content_hash FROM artifacts
     WHERE run_id = $1 AND kind = $2 ORDER BY id LIMIT 1 FOR UPDATE`,
    [run.id, kind],
  );
  const newHash = contentHash(content);
  let artifact;
  if (existing.length > 0) {
    artifact = existing[0];
    if (artifact.review_state !== 'draft') {
      throw new PolicyDeniedError(`成果物 ${artifact.artifact_code} はレビュー済みのため上書きできません`);
    }
    // 書き直し前の内容を履歴（artifact_revisions）へ残してから上書きする
    const { rows: rev } = await client.query(`SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM artifact_revisions WHERE artifact_id = $1`, [artifact.id]);
    await client.query(
      `INSERT INTO artifact_revisions (artifact_id, revision, title, content, content_hash, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
      [artifact.id, rev[0].n, artifact.title, JSON.stringify(artifact.content), artifact.content_hash || contentHash(artifact.content), 'Step の再実行による書き直し'],
    );
    await client.query(`UPDATE artifacts SET title = $1, content = $2, content_hash = $3, updated_at = now() WHERE id = $4`, [title, JSON.stringify(content), newHash, artifact.id]);
    await client.query(`DELETE FROM artifact_citations WHERE artifact_id = $1`, [artifact.id]);
    artifact = { id: artifact.id, artifact_code: artifact.artifact_code, kind, title, review_state: artifact.review_state, reused: true };
  } else {
    const artifactCode = await nextArtifactCode(client);
    const ih = inputHash(run.input_json || {});
    const prev = await findPreviousArtifact(client, { agentId: run.agent_id, kind, inputHash: ih, excludeRunId: run.id });
    const { rows } = await client.query(
      `INSERT INTO artifacts (artifact_code, run_id, kind, title, content, review_state, content_hash, input_hash, previous_artifact_id, lineage_version, expert_review_required, ai_completion_prohibited)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11) RETURNING id, artifact_code, kind, title, review_state, previous_artifact_id, lineage_version, expert_review_required, ai_completion_prohibited`,
      [artifactCode, run.id, kind, title, JSON.stringify(content), newHash, ih, prev ? prev.id : null, prev ? Number(prev.lineage_version) + 1 : 1, risk.expert_review_required, risk.ai_completion_prohibited],
    );
    artifact = { ...rows[0], reused: false };
  }
  for (const s of content.sources || []) {
    if (!s.source_record_id) continue;
    await client.query(
      `INSERT INTO artifact_citations (artifact_id, source_record_id, locator) VALUES ($1,$2,$3)`,
      [artifact.id, s.source_record_id, s.locator || null],
    );
  }
  // pg は BIGINT を文字列で返すため、Skill出力の JSON Schema（type: integer）に合わせて Number() へ正規化する。
  return { artifact: { ...artifact, id: Number(artifact.id) } };
}

const TOOL_HANDLERS = {
  'knowledge.search-approved': (client, args) => toolKnowledgeSearchApproved(client, args),
  'knowledge.search-promoted': (client, args) => toolKnowledgeSearchPromoted(client, args),
  'source.read-approved-snapshot': (client, args) => toolSourceReadApprovedSnapshot(client, args),
  'artifact.write-draft': (client, args) => toolArtifactWriteDraft(client, args),
};

/**
 * 評価ランナー専用: 読み取り専用 Tool を run_events へ記録せずに実行する。
 * 書き込み Tool（artifact.write-draft）は DB に触れず、偽の成果物 ID を返す（評価で本番データを作らない）。
 */
export async function invokeToolForEvaluation(client, toolName, args) {
  if (toolName === 'artifact.write-draft') {
    return { artifact: { id: 0, artifact_code: 'ART-EVAL', kind: args.kind, title: args.title, review_state: 'draft', reused: false, evaluation_stub: true } };
  }
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new PolicyDeniedError(`Tool「${toolName}」は登録されていません`);
  return handler(client, args);
}

/**
 * Tool呼び出しの唯一の入口。policy-engineでの許可判定 → run_eventsへの記録 → 実行 → 結果記録、の順で行う。
 */
export async function callTool(client, { run, skillVersion, toolName, args }) {
  try {
    authorizeToolCall({ skillVersion, toolName });
  } catch (err) {
    await appendEvent(client, run.id, {
      type: 'tool_call', skillId: skillVersion.skill_id, skillVersion: skillVersion.version,
      toolName, status: 'deny', detail: { error: err.message },
    });
    throw err;
  }

  await appendEvent(client, run.id, {
    type: 'tool_call', skillId: skillVersion.skill_id, skillVersion: skillVersion.version,
    toolName, status: 'permit', detail: { args: redactArgs(args) },
  });

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new PolicyDeniedError(`Tool「${toolName}」の実装がありません`);
  try {
    const result = await handler(client, { run, ...args });
    return result;
  } catch (err) {
    await appendEvent(client, run.id, {
      type: 'tool_call', skillId: skillVersion.skill_id, skillVersion: skillVersion.version,
      toolName, status: 'error', detail: { error: err.message },
    });
    throw err;
  }
}

/** 秘密・個人情報・位置情報らしき値をログへ残さないための簡易マスク（既知キー名のみ）。 */
function redactArgs(args) {
  const clone = { ...args };
  for (const key of ['password', 'apiKey', 'api_key', 'token', 'secret']) {
    if (key in clone) clone[key] = '[REDACTED]';
  }
  return clone;
}
