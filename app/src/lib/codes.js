/**
 * 案件ID発番（README「05. 案件ID発番」の DX-YYYY-NNNN 方式に倣う）。
 * 採番はテーブルの当年件数 + 1 に依存するため、呼び出し側は同一トランザクション内で実行すること。
 * SQL インジェクション対策として、テーブル・カラム名を動的組み立てにせず用途別関数として固定する。
 */
function formatCode(prefix, year, seq) {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

export async function nextRequestCode(client, year = new Date().getFullYear()) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM requests WHERE request_code LIKE $1`,
    [`REQ-${year}-%`],
  );
  return formatCode('REQ', year, rows[0].n + 1);
}

export async function nextProjectCode(client, year = new Date().getFullYear()) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM projects WHERE project_code LIKE $1`,
    [`AGENTOS-${year}-%`],
  );
  return formatCode('AGENTOS', year, rows[0].n + 1);
}
