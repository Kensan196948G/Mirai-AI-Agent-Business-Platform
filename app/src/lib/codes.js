/**
 * 各種コードの採番。
 * 「件数 + 1」方式は行が削除されると既存コードと衝突する（本番で草案 4 件を削除した後に ART-1005 が
 * 重複し Run が失敗した）ため、既存コードの数値部分の最大値 + 1 で採番する。
 * 同一トランザクション内で採番して INSERT すること。SQL インジェクション対策として、テーブル・カラム名は
 * 動的に組み立てず用途別の固定 SQL にする。
 */
function formatCode(prefix, year, seq) {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

async function maxSeq(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n) || 0;
}

export async function nextRequestCode(client, year = new Date().getFullYear()) {
  const n = await maxSeq(client, `SELECT MAX(substring(request_code FROM '-(\\d+)$')::int) AS n FROM requests WHERE request_code LIKE $1`, [`REQ-${year}-%`]);
  return formatCode('REQ', year, n + 1);
}

export async function nextProjectCode(client, year = new Date().getFullYear()) {
  const n = await maxSeq(client, `SELECT MAX(substring(project_code FROM '-(\\d+)$')::int) AS n FROM projects WHERE project_code LIKE $1`, [`AGENTOS-${year}-%`]);
  return formatCode('AGENTOS', year, n + 1);
}

/** ART-1001, ART-1002 … */
export async function nextArtifactCode(client) {
  const n = await maxSeq(client, `SELECT MAX(substring(artifact_code FROM '^ART-(\\d+)$')::int) AS n FROM artifacts`);
  return `ART-${Math.max(n, 1000) + 1}`;
}

/** RUN-1001 … */
export async function nextRunCode(client) {
  const n = await maxSeq(client, `SELECT MAX(substring(run_code FROM '^RUN-(\\d+)$')::int) AS n FROM agent_runs`);
  return `RUN-${Math.max(n, 1000) + 1}`;
}

/** KC-0301 … （既存データは KC-0302 のようにゼロ埋め 4 桁と KC-301 の両方があるため数値で比較する） */
export async function nextKcCode(client) {
  const n = await maxSeq(client, `SELECT MAX(substring(kc_code FROM '^KC-(\\d+)$')::int) AS n FROM knowledge_candidates`);
  return `KC-${String(Math.max(n, 300) + 1).padStart(4, '0')}`;
}

/** T-1001 … */
export async function nextTaskCode(client) {
  const n = await maxSeq(client, `SELECT MAX(substring(task_code FROM '^T-(\\d+)$')::int) AS n FROM tasks`);
  return `T-${Math.max(n, 1000) + 1}`;
}

/** APR-0101 …（seed データと同じ 4 桁ゼロ埋め） */
export async function nextApprovalCode(client) {
  const n = await maxSeq(client, `SELECT MAX(substring(approval_code FROM '^APR-(\\d+)$')::int) AS n FROM approval_requests`);
  return `APR-${String(Math.max(n, 100) + 1).padStart(4, '0')}`;
}
