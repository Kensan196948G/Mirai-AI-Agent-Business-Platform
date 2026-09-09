/**
 * 外部連携コネクタ（D-20〜D-23 の基盤）。
 * 「未接続を成功表示しない」（設計文書 §正式承認 / ADR-001）を実装で保証する:
 *   - 接続状態は画面の手動設定ではなく、環境変数の有無と読み取り専用の疎通確認（check）で決める
 *   - 書き込み（A2: Notion 確定登録、Slack 送信、NEO 承認の参照更新）は本モジュールでは行わない。
 *     実装時は Skill 契約の approval_gate と effect_ledger（冪等台帳）を必ず通す
 *   - 資格情報は環境変数（Secrets）からのみ読み、値をログ・応答・DB に出さない
 *   - 開発用 Mock は本番で受理しない（NODE_ENV=production では mock を無効化）
 */

const TIMEOUT_MS = 8000;

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 応答 */ }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 各コネクタ: { id, name, role, autonomy, env: [必要な環境変数], read, write, spec, check() }
 *   autonomy: 'A1'（読み取りのみ）/ 'A2'（正式承認に拘束された書き込み）
 *   spec: 'confirmed'（API 仕様確認済み）/ 'unconfirmed'（顧客環境の API 仕様・契約の確認待ち）
 */
export const CONNECTORS = {
  notion: {
    id: 'notion', name: 'Notion', role: 'Knowledge SoR', autonomy: 'A2', spec: 'confirmed',
    env: ['NOTION_API_TOKEN', 'NOTION_KNOWLEDGE_DATABASE_ID'],
    read: 'レビュー済み Knowledge の参照（読み取りスナップショット）', write: 'promoted Knowledge のページ作成（承認拘束・冪等台帳経由）',
    async check(env) {
      const r = await fetchJson('https://api.notion.com/v1/users/me', { headers: { Authorization: `Bearer ${env.NOTION_API_TOKEN}`, 'Notion-Version': '2022-06-28' } });
      return r.ok ? { ok: true, detail: `Notion API 疎通 OK（integration: ${r.json?.name || 'bot'}）` } : { ok: false, detail: `Notion API 応答 ${r.status}` };
    },
  },
  slack: {
    id: 'slack', name: 'Slack', role: 'Collaboration', autonomy: 'A2', spec: 'confirmed',
    env: ['SLACK_BOT_TOKEN', 'SLACK_NOTIFY_CHANNEL'],
    read: 'なし（Slack の生ログは Knowledge 化しない）', write: 'Run 完了・レビュー依頼・失敗の通知（承認拘束・冪等台帳経由）。Slack の「OK」を正式承認に変換しない',
    async check(env) {
      const r = await fetchJson('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
      return r.ok && r.json?.ok ? { ok: true, detail: `Slack auth.test OK（workspace: ${r.json.team || '-'}）` } : { ok: false, detail: `Slack auth.test 失敗（${r.json?.error || r.status}）` };
    },
  },
  github: {
    id: 'github', name: 'GitHub', role: 'Engineering SoR', autonomy: 'A1', spec: 'confirmed',
    env: ['GITHUB_API_TOKEN', 'GITHUB_REPOSITORY'],
    read: 'PR / Release の状態参照', write: 'なし（Merge / Release は CI と人の承認で行う）',
    async check(env) {
      const r = await fetchJson(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}`, { headers: { Authorization: `Bearer ${env.GITHUB_API_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MiraiAgentOS' } });
      return r.ok ? { ok: true, detail: `GitHub API 疎通 OK（${r.json?.full_name || env.GITHUB_REPOSITORY}）` } : { ok: false, detail: `GitHub API 応答 ${r.status}` };
    },
  },
  gmail: {
    id: 'gmail', name: 'Gmail', role: 'Mail Gateway', autonomy: 'A2', spec: 'unconfirmed',
    env: ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'],
    read: '受信メールの分類（契約・金額・機密・承認事項は自動返信禁止: SEC-006）', write: '自動返信（対象限定・承認拘束）',
    async check() {
      return { ok: false, detail: 'Gmail は OAuth 同意フローが必要で、本アプリからの自動疎通確認は未実装（仕様確認待ち）' };
    },
  },
  neo: {
    id: 'neo', name: "desknet's NEO Workflow", role: '正式承認 SoR', autonomy: 'A1', spec: 'unconfirmed',
    env: ['NEO_BASE_URL', 'NEO_API_TOKEN'],
    read: '承認結果（承認番号・状態・承認者・日時）の検証済み参照。手入力の承認番号は「未検証」のまま扱う', write: 'なし（承認の作成・判定は NEO 側で人が行う）',
    async check(env) {
      // desknet's NEO の API 仕様（エンドポイント・認証方式）は顧客環境で要確認。base URL の到達性だけを確認する
      const r = await fetchJson(String(env.NEO_BASE_URL).replace(/\/$/, '') + '/', { headers: { Authorization: `Bearer ${env.NEO_API_TOKEN}` } });
      return r.status > 0 && r.status < 500 ? { ok: false, detail: `NEO に到達（HTTP ${r.status}）。承認参照 API の仕様確認が未完了のため「接続済み」にはしない` } : { ok: false, detail: `NEO に到達できません（${r.status}）` };
    },
  },
  appsuite: {
    id: 'appsuite', name: 'AppSuite', role: '案件・Phase・KPI SoR', autonomy: 'A1', spec: 'unconfirmed',
    env: ['APPSUITE_BASE_URL', 'APPSUITE_API_TOKEN', 'APPSUITE_PROJECT_APP_ID'],
    read: '共通案件 ID（DX-YYYY-NNNN）による案件・Phase の参照と Run / 成果物の対応付け', write: 'なし（状態控えの更新は仕様確認後に承認拘束で検討）',
    async check(env) {
      const r = await fetchJson(String(env.APPSUITE_BASE_URL).replace(/\/$/, '') + '/', { headers: { Authorization: `Bearer ${env.APPSUITE_API_TOKEN}` } });
      return r.status > 0 && r.status < 500 ? { ok: false, detail: `AppSuite に到達（HTTP ${r.status}）。案件参照 API の仕様確認が未完了のため「接続済み」にはしない` } : { ok: false, detail: `AppSuite に到達できません（${r.status}）` };
    },
  },
};

export function listConnectorIds() {
  return Object.keys(CONNECTORS);
}

/** 環境変数の有無から設定状況を返す（値は返さない）。 */
export function runtimeStatus(id, env = process.env) {
  const c = CONNECTORS[id];
  if (!c) return null;
  const missing = c.env.filter((k) => !env[k]);
  const configured = missing.length === 0;
  return {
    id, autonomy: c.autonomy, spec: c.spec, read: c.read, write: c.write, required_env: c.env,
    configured, missing_env: missing,
    mode: !configured ? 'unconfigured' : (c.spec === 'unconfirmed' ? 'spec_unconfirmed' : (c.autonomy === 'A2' ? 'read-only（書き込みは承認拘束の実装後）' : 'read-only')),
    blocked_reason: !configured ? `環境変数が未設定: ${missing.join(', ')}` : (c.spec === 'unconfirmed' ? 'API 仕様・契約の確認待ち' : null),
  };
}

/** 読み取り専用の疎通確認。未設定なら外部へ出ずに理由を返す。 */
export async function checkConnector(id, env = process.env) {
  const c = CONNECTORS[id];
  if (!c) return { ok: false, detail: `未知の連携: ${id}` };
  const rs = runtimeStatus(id, env);
  if (!rs.configured) return { ok: false, detail: rs.blocked_reason, checked: false };
  try {
    const r = await c.check(env);
    return { ...r, checked: true };
  } catch (err) {
    return { ok: false, detail: `疎通確認でエラー: ${err.message}`, checked: true };
  }
}
