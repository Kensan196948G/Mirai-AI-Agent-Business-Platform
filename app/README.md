# Mirai AgentOS — MVP バックエンド

`doc/` の要件定義書・技術設計概要が定義する Agentic Operating System のうち、
**「案件依頼登録（Idea）→ Project 昇格 → Gate 承認」という 1 本の User Journey** を
実 PostgreSQL・実セッション認証で動かす最小垂直スライス。

Intent Router / Planner / Agent Orchestrator / Model Router / Notion・Slack・Gmail・GitHub 連携 /
authentik / Tailscale / Prometheus・Loki・Grafana は本 MVP のスコープ外（`doc/` 参照）。

> ℹ️ **命名について**：公開ドメインは `mirai-agent-os(-mvp).mirai-dx-platform.com`（2026-09-08 訂正済み）。
> 一方、内部識別子は初期実装時の `mira-agent-os`（"i" 抜け）系列のまま据え置いている：
> API の systemd unit名は `mira-agent-os-api.service` / `mira-agent-os-mvp-api.service`、
> DB名は `mira_agent_os` / `mira_agent_os_mvp`（アンダースコア区切り）、npmパッケージ名は `mira-agent-os`。
> 今回追加した Cloudflare Tunnel 用 systemd unit（`mirai-agent-os-cloudflared.service` 等）のみ
> 訂正後の綴りを使っている。据え置いた理由は稼働中DBのリネームがダウンタイムを伴うため
> （姉妹プロダクトにも内部識別子と公開ドメインが完全一致しない例がある）。
> `DATABASE_URL` 設定時は上記の正確な名前（アンダースコア区切り）を使うこと。
> まとめてリネームする場合は別PRで対応する。

## 構成

| 項目 | 内容 |
|---|---|
| 実行環境 | Node.js 20+、Express 4、pg（node-postgres） |
| DB | Local PostgreSQL 16。本番 `mira_agent_os` / MVP `mira_agent_os_mvp` / テスト `mira_agent_os_test` |
| 認証 | email + password（scrypt）。セッションは署名付き Cookie（HMAC-SHA256）+ `users.token_version` によるサーバ側失効 |
| ロール | Administrator / Developer / Reviewer / Approver / Knowledge Curator / Viewer（要件定義書 03節） |

## セットアップ

```bash
npm install
cp .env.example .env   # DATABASE_URL, SESSION_SECRET, PORT を設定
node migrate.mjs       # 冪等。空DBへ何度でも再実行可能
node seed-admin.mjs <email> [name]   # Administrator を1人作成。パスワードは実行時のみ表示
npm start
```

## テスト

```bash
npm run test:unit   # 純粋ロジック（auth・codes）。DB不要
npm run test:e2e    # 主要 User Journey の E2E。使い捨てテストDB必須（DATABASE_URL に "test" を含むことを強制）
```

`test:e2e` は対象DBの `users / requests / projects / approval_requests / audit_log` を
**DROP して作り直す**。本番・MVP の DATABASE_URL に向けて実行しないこと（安全策として
DATABASE_URL に `test` という文字列が含まれない場合は起動時に拒否する）。

## API

| Method | Path | 認可 | 内容 |
|---|---|---|---|
| POST | `/api/auth/login` | - | ログイン、セッション Cookie 発行 |
| POST | `/api/auth/logout` | 要ログイン | `token_version` をインクリメントして全セッションを即時失効 |
| GET | `/api/auth/me` | 要ログイン | 現在ユーザー情報 |
| POST | `/api/requests` | 要ログイン | 案件依頼を登録（FR-001） |
| GET | `/api/requests` | 要ログイン | 依頼一覧 |
| POST | `/api/requests/:id/promote` | Administrator / Developer | Project 昇格 + 承認依頼作成（FR-003） |
| GET | `/api/projects`, `/api/projects/:id` | 要ログイン | Project 一覧・詳細（承認履歴付き） |
| GET | `/api/approvals` | 要ログイン | 承認待ち一覧 |
| POST | `/api/approvals/:id/decide` | Administrator / Approver | 承認/却下（FR-101〜103）。二重判定は 409 |

すべての作成・昇格・承認操作は `audit_log` に記録される（FR-103 の Evidence 要件）。

## WebUI（`app/public/dashboard.html`）

2026-09-08、ログイン後の画面を Claude Design プロジェクト（`https://claude.ai/design/p/17a2926e-a8b0-41ea-95a5-a5902d7118f4` の「Mirai AgentOS WebUI」アートボード）から**正本ファイルをそのまま**移植した。手動での再現（CSS変数の抽出だけに基づく再構築）ではなく、以下 3 ファイルを無改変でホストしている:

| ファイル | 内容 |
|---|---|
| `dashboard.html` | 正本アートボードそのもの（サイドバー・ヘッダー・11画面） |
| `support.js` | Design Components 実行エンジン（自動生成。React を unpkg.com から SRI 付きで自前ロードする） |
| `agentos-data.js` | 正本のモック/デモデータ（`export function seed()`）。ブラウザの localStorage に状態を保持 |

**現状は 11 画面すべてモックデータ**（ダッシュボード・AI相談・案件・タスク・承認・Knowledge・監査ログ・外部連携・監視・エージェント設定・ユーザー管理）。実 PostgreSQL バックエンド（本 README 冒頭の API）とはまだ接続していない。ログイン画面（`index.html`）のみ実認証・実DBに接続済み。

### 既知の制約（このWebUI）

- localStorage キー `mirai-agentos-state` にブラウザごとの状態を保持する（複数ユーザー間・複数デバイス間で共有されない）
- ログアウト導線は正本デザインに存在しないため未実装（`index.html` の実ログアウトAPIとは別経路）
- 実データ接続（Requests/Projects/Approvals API との連携）は別途対応

## 既知の制約（MVP スコープ）

- ロール割当は DB に直接 INSERT する運用（管理 UI 未実装）
- authentik / SSO 未統合。単一 email+password のみ
- Notion / Slack / Gmail / GitHub 連携、Model Router、Workflow Engine の Phase/Gate 管理は未実装
- ログイン画面（`index.html`）はバニラ JS。ログイン後（`dashboard.html`）は React（unpkg.com から CDN ロード）を使う Design Components 実行エンジン上で動作
