/**
 * 監査ログの Hash Chain（F-30 で版付き強化）。
 *   hash_version 1: 32bit の簡易ハッシュ（djb2 風、既存行。再署名しない）
 *   hash_version 2: SHA-256（以後の新規行）。prev_hash には直前行の hash（版を問わず）を連結する
 * 並行追記は advisory lock で直列化し、チェーンの分岐を防ぐ。
 * 日次アンカー（audit_anchors + DB 外の追記専用ファイル）で「後から過去を書き換える」改ざんを検出できるようにする。
 */
import { createHash } from 'node:crypto';

export const CURRENT_HASH_VERSION = 2;

/** djb2 風の単純ハッシュ（hash_version=1、agentos-data.js の hash() と同一実装） */
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
  // Date 等（toJSON を持つ値）は JSON.stringify と同じ表現（ISO 文字列）にする。素のキー走査だと {} になり、DB 往復後の hash が再現できない
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.toJSON === 'function') return stableStringify(value.toJSON());
  // undefined / function / symbol は JSON.stringify と同じ扱いにする: 配列要素なら null、object のキーなら省略。
  // detail オブジェクトはルート側で `{ role, dept, name, email, active }` のように未指定フィールドを
  // 明示的な undefined 値として渡すことが多く、PostgreSQL の JSONB へ保存する時点（pg ドライバの
  // JSON.stringify 相当）ではそのキー自体が失われる。ここで先に同じ規則を適用しないと、
  // INSERT 時の hash と DB 往復後に再計算した hash が一致せず、Hash Chain の検証が壊れる。
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v) ?? 'null').join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => {
      const v = value[k];
      return v !== undefined && typeof v !== 'function' && typeof v !== 'symbol';
    }).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

export function hashFor(version, str) {
  return Number(version) === 2 ? sha256(str) : hash(str);
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
  // 並行追記の直列化: 直前 hash の読み取りと INSERT の間に別トランザクションが割り込むとチェーンが分岐する
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('audit_log_append'))`);
  const { rows } = await client.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = rows[0]?.hash || '00000000';
  const newHash = hashFor(CURRENT_HASH_VERSION, prevHash + canonicalize(entry));

  // target_id は BIGINT の旧カラム（互換用）。integrations('notion' 等)のような非数値IDは
  // 格納できないため、数値変換できる場合のみ埋め、それ以外は NULL にする。
  // 以後の正は resource_type/resource_id（TEXT）。
  const numericId = Number(entry.resourceId);
  const legacyTargetId = Number.isFinite(numericId) ? numericId : null;

  const inserted = await client.query(
    `INSERT INTO audit_log
       (actor_id, actor_type, actor_name, action, target_type, target_id, resource_type, resource_id, detail, prev_hash, hash, hash_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      CURRENT_HASH_VERSION,
    ],
  );
  return { id: inserted.rows[0].id, createdAt: inserted.rows[0].created_at, hash: newHash, prevHash, hashVersion: CURRENT_HASH_VERSION };
}

/**
 * 保存済みの audit_log を先頭（最古）から検証し、chain が連結しているかを確認する。
 * 行ごとの hash_version（無ければ 1）でアルゴリズムを切り替える。startPrev を渡すとアンカー以降だけを検証できる。
 */
export function verifyChain(rows, { startPrev = '00000000' } = {}) {
  let prev = startPrev;
  const breaks = [];
  const versions = {};
  for (const row of rows) {
    const v = Number(row.hash_version || 1);
    versions[v] = (versions[v] || 0) + 1;
    if (row.prev_hash !== prev) {
      breaks.push({ id: row.id, expected: prev, found: row.prev_hash });
    }
    const expectedHash = hashFor(
      v,
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
  return { ok: breaks.length === 0, breaks, versions, lastHash: prev };
}

/** アンカー値: 直前アンカーと末尾の状態を SHA-256 で固定する。 */
export function computeAnchorHash({ prevAnchorHash, lastAuditId, lastHash, entryCount }) {
  return sha256(`${prevAnchorHash || ''}|${lastAuditId}|${lastHash}|${entryCount}`);
}

/**
 * 日次アンカーを作る。直前アンカー以降のチェーンを検証し、末尾を audit_anchors に固定する。
 * 戻り値: { anchor, verified: { ok, breaks, checked } }。チェーンが壊れていてもアンカーは記録し chain_ok=false で残す（隠さない）。
 */
export async function recordAnchor(client, { externalRef = null } = {}) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('audit_log_append'))`);
  const { rows: prevRows } = await client.query(`SELECT * FROM audit_anchors ORDER BY id DESC LIMIT 1`);
  const prevAnchor = prevRows[0] || null;
  const { rows } = await client.query(
    `SELECT id, actor_type, actor_name, action, resource_type, resource_id, detail, prev_hash, hash, hash_version
     FROM audit_log WHERE id > $1 ORDER BY id ASC`,
    [prevAnchor ? prevAnchor.last_audit_id : 0],
  );
  const verified = verifyChain(rows, { startPrev: prevAnchor ? prevAnchor.last_hash : '00000000' });
  const { rows: total } = await client.query(`SELECT count(*)::bigint AS n, COALESCE(MAX(id), 0)::bigint AS last_id FROM audit_log`);
  const lastAuditId = Number(total[0].last_id);
  const lastHash = rows.length > 0 ? verified.lastHash : (prevAnchor ? prevAnchor.last_hash : '00000000');
  const entryCount = Number(total[0].n);
  const anchorHash = computeAnchorHash({ prevAnchorHash: prevAnchor?.anchor_hash || null, lastAuditId, lastHash, entryCount });
  const { rows: inserted } = await client.query(
    `INSERT INTO audit_anchors (last_audit_id, last_hash, entry_count, anchor_hash, prev_anchor_hash, chain_ok, external_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [lastAuditId, lastHash, entryCount, anchorHash, prevAnchor?.anchor_hash || null, verified.ok, externalRef],
  );
  return { anchor: inserted[0], verified: { ok: verified.ok, breaks: verified.breaks, checked: rows.length } };
}

/** 保存済みアンカー同士の連結と、各アンカーが指す audit_log の行が今もその hash を持つかを検証する。 */
export async function verifyAnchors(client) {
  const { rows: anchors } = await client.query(`SELECT * FROM audit_anchors ORDER BY id ASC`);
  const problems = [];
  let prev = null;
  for (const a of anchors) {
    const expected = computeAnchorHash({ prevAnchorHash: prev?.anchor_hash || null, lastAuditId: Number(a.last_audit_id), lastHash: a.last_hash, entryCount: Number(a.entry_count) });
    if (expected !== a.anchor_hash) problems.push({ anchor_id: Number(a.id), problem: 'anchor_hash が再計算と一致しません' });
    if ((a.prev_anchor_hash || null) !== (prev?.anchor_hash || null)) problems.push({ anchor_id: Number(a.id), problem: '直前アンカーとの連結が不一致です' });
    if (Number(a.last_audit_id) > 0) {
      const { rows } = await client.query(`SELECT hash FROM audit_log WHERE id = $1`, [a.last_audit_id]);
      if (!rows[0]) problems.push({ anchor_id: Number(a.id), problem: `audit_log id=${a.last_audit_id} が存在しません（削除の疑い）` });
      else if (rows[0].hash !== a.last_hash) problems.push({ anchor_id: Number(a.id), problem: `audit_log id=${a.last_audit_id} の hash がアンカー時点と異なります（改変の疑い）` });
    }
    prev = a;
  }
  return { ok: problems.length === 0, anchors: anchors.length, problems, latest: anchors[anchors.length - 1] || null };
}
