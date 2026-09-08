# Mirai AgentOS — バックエンド + WebUI

`doc/` の要件定義書・技術設計概要が定義する Agentic Operating System のうち、
**「本格実装」フェーズ（2026-09-08）** として、ログイン後の全11画面
（ダッシュボード / AI相談 / 案件 / タスク・実行 / 承認 / Knowledge / 監査ログ /
外部連携 / 監視 / エージェント設定 / ユーザー・ロール）を実 PostgreSQL に接続した。

**実 AI エージェント実行・外部API（Notion/Slack/Gmail/GitHub）の自動連携は行っていない。**
Intent Router / Planner / Agent Orchestrator / 実モデル呼び出しは本スコープ外（`doc/` 参照）。
Integrations は「接続状態を人が設定する管理テーブル」、Chat は「登録済みシナリオへの
ルールベース応答をDB永続化するのみ」、Tasks は「Agent実行ログとして記録される実テーブル」
として実装している（すべて `doc/` に対する意図的な縮小スコープ）。

> ℹ️ **命名について**：公開ドメインは `mirai-agent-os(-mvp).mirai-dx-platform.com`（2026-09-08 訂正済み）。
> 一方、内部識別子は初期実装時の `mira-agent-os`（"i" 抜け）系列のまま据え置いている：
> API の systemd unit名は `mira-agent-os-api.service` / `mira-agent-os-mvp-api.service`、
> DB名は `mira_agent_os` / `mira_agent_os_mvp`（アンダースコア区切り）、npmパッケージ名は `mira-agent-os`。
> `DATABASE_URL` 設定時は上記の正確な名前（アンダースコア区切り）を使うこと。

## 構成

| 項目 | 内容 |
|---|---|
| 実行環境 | Node.js 20+、Express 4、pg（node-postgres） |
| DB | Local PostgreSQL 16。本番 `mira_agent_os` / MVP `mira_agent_os_mvp` / テスト `mira_agent_os_test` |
| 認証 | email + password（scrypt）。セッションは署名付き Cookie（HMAC-SHA256）+ `users.token_version` によるサーバ側失効 |
| ロール | Administrator / Developer / Reviewer / Approver / Knowledge Curator / Viewer（要件定義書 03節）。**WebUI上は読み取り専用**（サーバ側の実ロールで判定） |
| WebUI | ログイン画面（`index.html`、バニラJS）+ ログイン後の本体（`dashboard.html`、React。正本 Claude Design アートボードを移植） |

## ディレクトリ

```
app/
├── migrations/          001_init.sql, 002_session_versioning.sql, 003_full_backend.sql
├── src/
│   ├── lib/              db.js, auth.js, config.js, env.js, codes.js, workflow.js, audit.js, chatScenarios.js
│   ├── middleware/auth.js  requireAuth / requireRole
│   ├── routes/           auth, requests, projects, approvals, tasks, knowledge,
│   │                     audit-log, users, platform（integrations/agents/skills/router/usage）,
│   │                     dashboard, chat
│   └── server.js
├── public/               index.html（ログイン）, dashboard.html（本体WebUI）, support.js, agentos-data.js
├── seed-admin.mjs        Administrator を1人作成
├── seed-demo-data.mjs    WebUI正本のデモデータ（users/projects/tasks/approvals/knowledge/...）を投入
└── test/                 unit.test.mjs, workflow.test.mjs, audit.test.mjs, e2e.test.mjs
```

## セットアップ

```bash
npm install
cp .env.example .env   # DATABASE_URL, SESSION_SECRET, PORT を設定
node migrate.mjs           # 冪等。空DBへ何度でも再実行可能
node seed-admin.mjs <email> [name]   # Administrator を1人作成。パスワードは実行時のみ表示
node seed-demo-data.mjs    # 任意。WebUI正本のデモデータを投入（冪等）
npm start
```

## テスト

```bash
npm run test:unit   # 純粋ロジック（auth・codes・workflow・audit hash chain）。DB不要
npm run test:e2e    # 主要User Journey + 多段階承認 + Task/Knowledge + Audit検証 + Chat + Dashboard の E2E
```

`test:e2e` は対象DBの全テーブルを **DROP して作り直す**。本番・MVP の DATABASE_URL に
向けて実行しないこと（安全策として DATABASE_URL に `test` という文字列が含まれない場合は
起動時に拒否する）。

## API（抜粋。詳細は `src/routes/*.js`）

| 領域 | Method / Path | 内容 |
|---|---|---|
| 認証 | `POST /api/auth/login`, `/logout`, `GET /me` | ログイン・ログアウト（token_version即時失効）・現在ユーザー |
| Dashboard | `GET /api/dashboard` | KPI・パイプライン・最近のProject/Task・承認待ち・Usage集計を1回で返す |
| Requests/Projects | `POST /api/requests` → `/promote`、`GET/PATCH /api/projects/:id`、`POST /:id/transition`, `/:id/kpis` | 依頼登録→Project昇格→9状態ワークフロー遷移（`lib/workflow.js`） |
| Approvals | `GET /api/approvals`（全件+steps埋め込み）、`POST /:id/steps/:stepId/decide` | ロールベース多段階承認（project_gate=1段、production_release/github_merge=2段） |
| Tasks | `GET/POST /api/tasks`, `PATCH /:id` | Agent Run 実行ログ（Tool Call埋め込み） |
| Knowledge | `GET/POST /api/knowledge`, `PATCH /:id` | Knowledge候補の登録・昇格・却下 |
| Audit | `GET /api/audit`, `GET /api/audit/verify` | 軽量Hash Chain（`lib/audit.js`）。改ざん検知は再計算で検証 |
| Platform | `GET/PATCH /api/integrations`, `/agents`, `/skills`, `/router`, `GET /api/usage` | 連携状態・エージェント設定・モデルルーター（設定のみ、実行はしない）。Usageはtasksから集計 |
| Chat | `POST /api/chat/messages`, `GET /api/chat/conversations/me`, `POST /api/chat/conversations` | ルールベース応答（`lib/chatScenarios.js`）をDB永続化 |
| Users | `GET /api/users`, `PATCH /:id` | ユーザー一覧・ロール変更（Administrator限定） |

すべての作成・更新・承認操作は `audit_log` に Hash Chain 付きで記録される。

## WebUI（`app/public/dashboard.html`）

正本 Claude Design アートボード（`https://claude.ai/design/p/17a2926e-a8b0-41ea-95a5-a5902d7118f4`）
の `support.js` / `agentos-data.js`（定数のみ）をそのまま使い、Component の状態取得元を
モック（`D.seed()`/localStorage）から実APIへ差し替えた。レンダリングロジック（色・ラベル・
フォーマット等）は正本のものを再利用し、11画面すべてで実データが表示される。

正本デザインとの差分（実装上必要だった変更）:

- **ログイン画面自体は正本デザインに含まれない**ため、既存の `index.html`（実認証）をそのまま使う
- **ロール切替 `<select>` を削除し、読み取り専用バッジに変更**（実際の権限はサーバ側の実ロールで判定するため、クライアントで自由に切り替えられるUIは実装後は誤解を招く）
- **ログアウトボタンを追加**（正本に存在しないが実認証システムに必須）
- 差戻し（returned）・Agent の Model 変更・Webhook Events 一覧は未実装（トースト表示のみ）

Playwright（`playwright-core` + 既存 Chrome）でログイン→全画面遷移→ログアウト、および
承認の実操作（クリック → API → Audit記録）を目視・ログの両方で確認済み。

## 既知の制約（本格実装スコープ）

- authentik / SSO 未統合。単一 email+password のみ
- Notion / Slack / Gmail / GitHub は実API連携なし（Integrations は状態を人が手動設定するのみ）
- Chat の応答は正規表現マッチによる固定シナリオ（実LLM呼び出しなし）
- Task の実行・完了は実際のAIエージェントが行わない（Retry/CancelはStatus更新のみ）
- 承認ステップは「ロール」ベースで割り当てる（正本のような特定個人への事前割当ではない）
