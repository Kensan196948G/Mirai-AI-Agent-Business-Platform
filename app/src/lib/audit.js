/**
 * 監査ログの軽量 Hash Chain（WebUI 正本 `agentos-data.js` の hash() アルゴリズムをそのまま移植）。
 * 暗号学的な改ざん防止ではなく、正本デザインと同じ「追記型・連結ハッシュによる異常検知」を再現する。
 */

/** djb2 風の単純ハッシュ（agentos-data.js の hash() と同一実装） */
export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

/**
 * オブジェクトのキーを再帰的にソートしてから JSON.stringify する。
 * PostgreSQL の JSONB はオブジェクトキーの挿入順序を保持しないため、
 * INSERT時点の detail と、DB から読み戻した後の detail とで JSON.stringify の
 * 結果が変わり得る（＝hashが再現できなくなる）。ソートして安定化することで
 * 往復後も同一ハッシュを再計算できるようにする。
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalize(entry) {
  return stableStringify({
    actor_type: entry.actorType,
    actor_name: entry.actorName,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: String(entry.resourceId),
    detail: entry.detail ?? {},
  });
}

/**
 * audit_log へ1件記録し、直前のエントリの hash を prev_hash として連結する。
 * 呼び出し側のトランザクション（client）内で実行すること。
 */
export async function recordAudit(client, entry) {
  const { rows } = await client.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = rows[0]?.hash || '00000000';
  const newHash = hash(prevHash + canonicalize(entry));

  // target_id は BIGINT の旧カラム（互換用）。integrations('notion' 等)のような非数値IDは
  // 格納できないため、数値変換できる場合のみ埋め、それ以外は NULL にする。
  // 以後の正は resource_type/resource_id（TEXT）。
  const numericId = Number(entry.resourceId);
  const legacyTargetId = Number.isFinite(numericId) ? numericId : null;

  const inserted = await client.query(
    `INSERT INTO audit_log
       (actor_id, actor_type, actor_name, action, target_type, target_id, resource_type, resource_id, detail, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, created_at`,
    [
      entry.actorId ?? null,
      entry.actorType,
      entry.actorName,
      entry.action,
      entry.resourceType,
      legacyTargetId,
      entry.resourceType,
      String(entry.resourceId),
      entry.detail ?? {},
      prevHash,
      newHash,
    ],
  );
  return { id: inserted.rows[0].id, createdAt: inserted.rows[0].created_at, hash: newHash, prevHash };
}

/** 保存済みの audit_log を先頭（最古）から検証し、chain が連結しているかを確認する。 */
export function verifyChain(rows) {
  let prev = '00000000';
  const breaks = [];
  for (const row of rows) {
    if (row.prev_hash !== prev) {
      breaks.push({ id: row.id, expected: prev, found: row.prev_hash });
    }
    const expectedHash = hash(
      row.prev_hash +
        canonicalize({
          actorType: row.actor_type,
          actorName: row.actor_name,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          detail: row.detail,
        }),
    );
    if (row.hash !== expectedHash) {
      breaks.push({ id: row.id, expected: expectedHash, found: row.hash });
    }
    prev = row.hash;
  }
  return { ok: breaks.length === 0, breaks };
}
