/**
 * Tool Gateway: 登録済み・型付きToolのみを実行する。任意のShell/SQL/URL取得/動的JavaScriptは
 * LLMへ一切与えない。呼び出しは常に authorizeToolCall を経由し、許可・拒否どちらも
 * run_events へ記録する。
 */
import { authorizeToolCall, authorizeSourceAccess, PolicyDeniedError } from './policy-engine.js';
import { extractSearchTokens } from '../lib/search-tokens.js';
import { appendEvent } from './job-store.js';

/**
 * 承認済み出典の検索（B-12）。
 * 相談文から日本語対応の検索語を取り出し（lib/search-tokens.js）、title / summary / content_text への
 * 部分一致（pg_trgm GIN index）で候補を集め、一致した語数と title の類似度で並べる。
 * 有効期限切れ（effective_to < 今日）と未承認は除外する。
 */
async function toolKnowledgeSearchApproved(client, { query, sourceType, projectId }) {
  const tokens = extractSearchTokens(query);
  if (tokens.length === 0) return { candidates: [] };

  const params = [sourceType || null, projectId || null, String(query || ''), ...tokens.map((t) => `%${t}%`)];
  const hitExprs = tokens.map((_, i) => `(CASE WHEN title ILIKE $${i + 4} THEN 3 WHEN summary ILIKE $${i + 4} THEN 2 WHEN content_text ILIKE $${i + 4} THEN 1 ELSE 0 END)`);
  const { rows } = await client.query(
    `SELECT id, title, summary, evidence_type, source_type,
            (${hitExprs.join(' + ')}) AS hit_score,
            similarity(title, $3::text) AS title_sim
     FROM source_records
     WHERE status = 'approved'
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
       AND (classification = 'public' OR ($2::bigint IS NOT NULL AND project_scope = $2))
       AND ($1::text IS NULL OR source_type = $1)
       AND (${tokens.map((_, i) => `title ILIKE $${i + 4} OR summary ILIKE $${i + 4} OR content_text ILIKE $${i + 4}`).join(' OR ')})
     ORDER BY hit_score DESC, title_sim DESC, id
     LIMIT 10`,
    params,
  );
  // pg は BIGINT 列を文字列で返すため、JSON Schema（type: integer）検証に通るよう Number() で正規化する。
  return { candidates: rows.map((r) => ({ source_record_id: Number(r.id), title: r.title, summary: r.summary, evidence_type: r.evidence_type })) };
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

async function nextArtifactCode(client) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM artifacts`);
  return `ART-${1000 + rows[0].n + 1}`;
}

/**
 * 草案の保存。同一 Run・同一 kind の草案が既にあれば新規作成せず内容を更新する（冪等）。
 * Step の再試行（出力検証失敗・Worker再起動等）で同じ草案が重複作成されるのを防ぐ。
 * レビュー済み（review_state='reviewed'）の草案は上書きしない。
 */
async function toolArtifactWriteDraft(client, { run, kind, title, content }) {
  const { rows: existing } = await client.query(
    `SELECT id, artifact_code, kind, title, review_state FROM artifacts
     WHERE run_id = $1 AND kind = $2 ORDER BY id LIMIT 1 FOR UPDATE`,
    [run.id, kind],
  );
  let artifact;
  if (existing.length > 0) {
    artifact = existing[0];
    if (artifact.review_state !== 'draft') {
      throw new PolicyDeniedError(`成果物 ${artifact.artifact_code} はレビュー済みのため上書きできません`);
    }
    await client.query(`UPDATE artifacts SET title = $1, content = $2 WHERE id = $3`, [title, JSON.stringify(content), artifact.id]);
    await client.query(`DELETE FROM artifact_citations WHERE artifact_id = $1`, [artifact.id]);
    artifact = { ...artifact, title, reused: true };
  } else {
    const artifactCode = await nextArtifactCode(client);
    const { rows } = await client.query(
      `INSERT INTO artifacts (artifact_code, run_id, kind, title, content, review_state)
       VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id, artifact_code, kind, title, review_state`,
      [artifactCode, run.id, kind, title, JSON.stringify(content)],
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
