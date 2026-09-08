/**
 * 成果物が引用する source_record_id の実在性・承認状態・案件権限を検証する。
 * `source-citation-verify` Skillのハンドラと、`evidence-backed-draft`が共有して使う。
 */
import { authorizeSourceAccess, PolicyDeniedError } from './policy-engine.js';

export async function validateCitations(client, { run, sources }) {
  const valid = [];
  const invalid = [];
  for (const s of sources || []) {
    const id = s.source_record_id;
    const { rows } = await client.query(`SELECT * FROM source_records WHERE id = $1`, [id]);
    if (rows.length === 0) {
      invalid.push({ source_record_id: id, reason: '存在しません' });
      continue;
    }
    try {
      authorizeSourceAccess({ run, sourceRecord: rows[0] });
      valid.push(id);
    } catch (err) {
      const reason = err instanceof PolicyDeniedError ? err.message : '検証エラー';
      invalid.push({ source_record_id: id, reason });
    }
  }
  return { valid, invalid };
}
