/**
 * テスト DB ガード（F-34）。E2E は使い捨てテスト DB 以外では起動しない。
 * - DB 名は mira_agent_os_test（または mira_agent_os_test_<suffix>）のみ
 * - ロールは mira_agent_os_test_app のみ（本番 / MVP のロールでは動かない）
 * - 本番・MVP の DB 名（mira_agent_os / mira_agent_os_mvp）を明示的に拒否する
 */
export const TEST_DB_NAME = /^mira_agent_os_test(_[a-z0-9]+)?$/;
export const TEST_DB_ROLE = 'mira_agent_os_test_app';
export const FORBIDDEN_DB_NAMES = new Set(['mira_agent_os', 'mira_agent_os_mvp']);

export function assertTestDatabaseUrl(url) {
  if (!url) throw new Error('DATABASE_URL を使い捨てテスト用DBに設定してから実行すること');
  let u;
  try { u = new URL(url); } catch { throw new Error('DATABASE_URL の形式が不正です'); }
  const dbName = u.pathname.replace(/^\//, '');
  const role = decodeURIComponent(u.username || '');
  if (FORBIDDEN_DB_NAMES.has(dbName)) throw new Error(`安全のため本番 / MVP の DB（${dbName}）ではテストを実行しない`);
  if (!TEST_DB_NAME.test(dbName)) throw new Error(`安全のため DB 名は mira_agent_os_test[_suffix] のみ許可する（指定: ${dbName}）`);
  if (role !== TEST_DB_ROLE) throw new Error(`安全のためテスト DB のロールは ${TEST_DB_ROLE} のみ許可する（指定: ${role || '(なし)'}）`);
  return { dbName, role };
}
