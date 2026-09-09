# 🤖 Mirai AgentOS — バックエンド + WebUI

## 😊 3行でわかる、このアプリ

1. 🖥️ ログインすると **11個の画面**（ダッシュボード・AI相談・案件・タスク・承認など）が使える社内向けアプリ
2. 🗄️ 画面のデータは全部 **本物の PostgreSQL データベース**に保存される（ブラウザを変えても消えない）
3. 🤖 「AI」と名の付く機能（相談・タスク実行・外部連携）は、**実際にAIが自動で動くわけではない**部分が多い（下記「🧩 何が本物で、何がまだ人手か」参照）— ただし **AI相談だけは、設定すれば実際のAI（DeepSeek）に接続できる**

<details>
<summary>🧸 もっとやさしく：受付カウンターに例えると</summary>

- 🙋 ログイン＝社員証を見せて建物に入る
- 💬 AI相談＝受付AIに「困りごと」を話す（設定次第で本物のAIが返事、未設定なら決まった台本で返事）
- 🗂️ 案件・承認＝話が「正式なプロジェクト」になり、上司がハンコを押す
- 📋 タスク・監査ログ＝「誰が・いつ・何をしたか」の記録簿（改ざんすると分かる仕組み付き）
- ⚙️ 外部連携・エージェント設定＝Notion/Slack等との「つながり具合」を人が手で記録する管理画面（自動連携はしない）

</details>

---

## 🧩 何が本物で、何がまだ人手か

| 機能 | 状態 | 説明 |
|---|:---:|---|
| ログイン・ログアウト | 🟢 本物 | 実際のパスワード認証・実データベース |
| 案件・承認・タスク・Knowledge・監査ログ | 🟢 本物 | 全部 PostgreSQL に保存され、ブラウザを変えても同じ内容が見える |
| AI相談（Chat） | 🟡 設定次第 | `LLM_API_KEY` を設定すれば本物のAI（DeepSeek）が応答。未設定なら決まった台本（シナリオ）で応答（下記「🤖 AI相談への実LLM接続」参照） |
| Notion / Slack / Gmail / GitHub 連携 | 🔴 人手 | 「つながっているか」のステータスを人が画面で手動更新するだけ。実際の自動同期はしない |
| タスクの実行 | 🔴 人手 | AIエージェントが自動で作業するのではなく、実行ログを記録する台帳。Retry/Cancelは状態を書き換えるのみ |
| Model Router（AIの使い分け） | 🔴 人手 | 「このカテゴリにはこのモデルを使う」という設定を保存するだけ。実行時に自動で使い分けはしない |
| 業務Agent（技術選定・施工実績調査・Knowledge品質） | 🟡 設定次第 | 実行基盤（P0）+ みらい建設向け3Agent・12Skill（P1）+ WebUI「業務Agent」画面。実行できるのは検索・比較・草案作成まで。構造化StepはDeepSeek設定時のみ本物のAIが動く（下記「🧩 業務Agent Runtime」参照） |

`doc/` の要件定義書・技術設計概要が定義する Agentic Operating System の中で、上表が
「本格実装フェーズ（2026-09-08〜）」として実 PostgreSQL・実認証まで作り込んだ範囲。
Intent Router / Planner / Agent Orchestrator といった、AIが自律的に判断・実行する部分の
一部（技術選定支援等の限定Agent）はP0/P1として実装したが、P2（港湾・地盤等の業務拡張）・
P3（専門システムとの外部連携）は無効なBacklogのまま（`docs/decisions/ADR-001-agent-skill-runtime.md` 参照）。

> ℹ️ **命名について**：公開ドメインは `mirai-agent-os(-mvp).mirai-dx-platform.com`（2026-09-08 訂正済み）。
> 一方、内部識別子は初期実装時の `mira-agent-os`（"i" 抜け）系列のまま据え置いている：
> API の systemd unit名は `mira-agent-os-api.service` / `mira-agent-os-mvp-api.service`、
> DB名は `mira_agent_os` / `mira_agent_os_mvp`（アンダースコア区切り）、npmパッケージ名は `mira-agent-os`。
> `DATABASE_URL` 設定時は上記の正確な名前（アンダースコア区切り）を使うこと。

---

## 🏗️ 構成

| 項目 | 内容 |
|---|---|
| 🖥️ 実行環境 | Node.js 20+、Express 4、pg（node-postgres） |
| 🗄️ DB | Local PostgreSQL 16。本番 `mira_agent_os` / MVP `mira_agent_os_mvp` / テスト `mira_agent_os_test` |
| 🔐 認証 | email + password（scrypt）。セッションは署名付き Cookie（HMAC-SHA256）+ `users.token_version` によるサーバ側失効・無効化即時反映 |
| 👥 ロール | Administrator / Developer / Reviewer / Approver / Knowledge Curator / Viewer（要件定義書 03節）。**WebUI上は読み取り専用表示**（実際の権限判定は必ずサーバ側） |
| 🎨 WebUI | ログイン画面（`index.html`、バニラJS）+ ログイン後の本体（`dashboard.html`、React。正本 Claude Design アートボードを移植） |

## 📁 ディレクトリ

```
app/
├── migrations/          001_init.sql 〜 004_users_and_llm_chat.sql
├── src/
│   ├── lib/              db.js, auth.js, config.js, env.js, codes.js, workflow.js, audit.js,
│   │                     chatScenarios.js, llm.js（実LLM接続）
│   ├── middleware/auth.js  requireAuth / requireRole
│   ├── routes/           auth, requests, projects, approvals, tasks, knowledge,
│   │                     audit-log, users（CRUD・無効化）, platform（integrations/agents/skills/router/usage）,
│   │                     dashboard, chat
│   └── server.js
├── public/               index.html（ログイン）, dashboard.html（本体WebUI）, support.js, agentos-data.js
├── seed-admin.mjs        Administrator を1人作成
├── seed-demo-data.mjs    WebUI正本のデモデータ（users/projects/tasks/approvals/knowledge/...）を投入
└── test/                 unit.test.mjs, workflow.test.mjs, audit.test.mjs, llm.test.mjs, e2e.test.mjs
```

## 🚀 セットアップ

```bash
npm install
cp .env.example .env   # DATABASE_URL, SESSION_SECRET, PORT を設定
node migrate.mjs           # 冪等。空DBへ何度でも再実行可能
node seed-admin.mjs <email> [name]   # Administrator を1人作成。パスワードは実行時のみ表示
node seed-demo-data.mjs    # 任意。WebUI正本のデモデータを投入（冪等）
npm start
```

## 🧪 テスト

```bash
npm run test:unit   # 純粋ロジック（auth・codes・workflow・audit hash chain・llm）。DB不要
npm run test:e2e    # 主要User Journey + 多段階承認 + Task/Knowledge + Audit検証 + Chat + ユーザーCRUD + Dashboard の E2E
```

⚠️ `test:e2e` は対象DBの全テーブルを **DROP して作り直す**。本番・MVP の DATABASE_URL に
向けて実行しないこと（安全策として DATABASE_URL に `test` という文字列が含まれない場合は
起動時に拒否する）。

## 🔌 API（抜粋。詳細は `src/routes/*.js`）

| 領域 | Method / Path | 内容 |
|---|---|---|
| 認証 | `POST /api/auth/login`, `/logout`, `GET /me` | ログイン・ログアウト（token_version即時失効）・現在ユーザー |
| Dashboard | `GET /api/dashboard` | KPI・パイプライン・最近のProject/Task・承認待ち・Usage集計を1回で返す |
| Requests/Projects | `POST /api/requests` → `/promote`、`GET/PATCH /api/projects/:id`、`POST /:id/transition`, `/:id/kpis` | 依頼登録→Project昇格→9状態ワークフロー遷移（`lib/workflow.js`） |
| Approvals | `GET /api/approvals`（全件+steps埋め込み）、`POST /:id/steps/:stepId/decide` | ロールベース多段階承認（project_gate=1段、production_release/github_merge=2段） |
| Tasks | `GET/POST /api/tasks`, `PATCH /:id` | Agent Run 実行ログ（Tool Call埋め込み） |
| Knowledge | `GET/POST /api/knowledge`, `PATCH /:id` | Knowledge候補の登録・昇格・却下 |
| Audit | `GET /api/audit`, `GET /api/audit/verify` | 軽量Hash Chain（`lib/audit.js`）。改ざん検知は再計算で検証 |
| Platform | `GET/PATCH /api/integrations`, `/agents`, `/skills`, `/router`, `GET /api/usage` | 連携状態・エージェント設定・モデルルーター（設定のみ、実行はしない）。UsageはtasksとLLM月次利用額から集計 |
| Chat | `POST /api/chat/messages`, `GET /api/chat/conversations/me`, `POST /api/chat/conversations` | 実LLM（設定時）またはルールベース応答（`lib/chatScenarios.js`）をDB永続化 |
| Users | `GET/POST /api/users`, `PATCH/DELETE /:id`, `POST /:id/reset-password` | ユーザー一覧・作成・編集・無効化（論理削除）・パスワード再発行（Administrator限定） |

すべての作成・更新・承認操作は `audit_log` に Hash Chain 付きで記録される。

---

## 🤖 AI相談への実LLM接続（DeepSeek）

AI相談（Chat）画面は、環境変数を設定すると**本物のLLM（DeepSeek）**に接続できる。
未設定のままなら、これまでどおり決まったシナリオ（`lib/chatScenarios.js`）で応答する
（＝**設定しない限り、挙動は一切変わらない**）。

```bash
# .env / .env.mvp に追記する（値は絶対にコミットしない）
LLM_PROVIDER=deepseek
LLM_API_KEY=<DeepSeekで発行したAPIキー>
LLM_MODEL=deepseek-chat
LLM_MONTHLY_CAP_USD=5.00              # 月間ソフトキャップ（超過月は自動でルールベース応答へ戻る）
LLM_PRICE_INPUT_PER_1M=0.27           # 目安単価。実際の価格は都度 DeepSeek の料金ページで確認
LLM_PRICE_OUTPUT_PER_1M=1.10
```

- 😊 **かんたんに言うと**：AIとの雑談部分だけ本物のAIに任せられるが、「相談内容をどう分類するか（Idea構造化・Risk判定）」は引き続きルールベースのまま。だから実LLMが止まっても「案件化」ボタンは壊れない。
- 💰 コストは `chat_messages.cost`（AI相談）と `budget_reservations.spent_usd`／`run_events.cost`（業務Agent Run）に記録され、**両方を合算した当月利用額**が Observability画面の「AI相談 LLM月次予算」バーに表示される。上限に達すると AI相談はルールベース応答へフォールバックし、業務Agent Run は LLM を呼ばずに保留（failed・理由を明示）する。
- ⚠️ **DeepSeek APIキーは production secret に該当する。** production環境の `.env`/`.env.mvp` へ実際に設定する作業は、組織ポリシー上、コードのマージとは別に明示的な承認（Y/N）を経てから行うこと。

## 👥 ユーザー管理（作成・編集・無効化）

Administrator は Users 画面（または API）から次を行える。

- ➕ **新規ユーザー作成**：初期パスワードは作成直後の応答で**一度だけ**表示される（画面を閉じると二度と見られない）
- ✏️ **編集**：氏名・メール・部署・ロールの変更
- 🔑 **パスワード再発行**：本人がパスワードを忘れた場合など。再発行後は旧パスワードで即ログイン不可になる
- 🚫 **無効化（論理削除）**：`projects.owner_id` 等の参照整合性を壊さないため物理削除はしない。無効化すると既存セッションも即時失効し、ログイン不可になる。再度有効化も可能
- 🛡️ **安全装置**：自分自身の無効化、および「最後の1人のAdministrator」の無効化・降格は拒否される

## 🎨 WebUI（`app/public/dashboard.html`）

正本 Claude Design アートボード（`https://claude.ai/design/p/17a2926e-a8b0-41ea-95a5-a5902d7118f4`）
の `support.js` / `agentos-data.js`（定数のみ）をそのまま使い、Component の状態取得元を
モック（`D.seed()`/localStorage）から実APIへ差し替えた。レンダリングロジック（色・ラベル・
フォーマット等）は正本のものを再利用し、11画面すべてで実データが表示される。

正本デザインとの差分（実装上必要だった変更）:

- **ログイン画面自体は正本デザインに含まれない**ため、既存の `index.html`（実認証）をそのまま使う
- **ロール切替 `<select>` を削除し、読み取り専用バッジに変更**（実際の権限はサーバ側の実ロールで判定するため、クライアントで自由に切り替えられるUIは実装後は誤解を招く）
- **ログアウトボタンを追加**（正本に存在しないが実認証システムに必須）
- **Users画面に新規作成モーダル・状態バッジ・無効化/有効化/パスワード再発行ボタンを追加**
- **Chat画面のAI応答に「DeepSeek 応答 / シナリオ応答」バッジ、Observability画面にLLM月次予算バーを追加**
- 差戻し（returned）・Agent の Model 変更・Webhook Events 一覧は未実装（トースト表示のみ）

Playwright（`playwright-core` + 既存 Chrome）でログイン→全画面遷移→ログアウト、および
承認の実操作（クリック → API → Audit記録）を目視・ログの両方で確認済み。

## 🧩 業務Agent Runtime（P0/P1、API限定）

`app/src/agent-runtime/` に、みらい建設工業向けの業務Agentを安全に実行するための
共通基盤（P0）と、初期3Agent・12Skill（P1）を実装した。設計判断は
`docs/decisions/ADR-001-agent-skill-runtime.md`、詳細な調査は
`docs/Mirai-Agent-Skill-Architecture.md` を参照。

- 😊 **かんたんに言うと**：AIが「技術資料を探して比較する」ところまでは自動でやってくれるが、
  「本当に使えるか」の最終判断は必ず人がレビューする、という枠組み。
  サイドバー「業務Agent（Agent Runs）」から Run の開始・監視・成果物レビュー・版の承認ができる。

| 項目 | 状態 |
|---|:---:|
| Registry（版付きAgent/Skill管理、パストラバーサル対策込みローダー） | ✅ 実装・単体テスト済み |
| Policy Engine（Tool許可判定・案件越境防止・予算上限・グローバル禁止Tool） | ✅ 実装・単体テスト済み |
| Tool Gateway（登録済み型付きToolのみ実行。任意Shell/SQL/URL取得は不可） | ✅ 実装 |
| 永続Worker（Lease/Heartbeat/Checkpoint、cancel/resume） | ✅ 実装・E2Eテスト済み |
| 版の承認フロー（draft同期 → Administrator承認 / 取消、内容ハッシュ変更で自動draft化） | ✅ 実装・E2Eテスト済み（`/api/agent-catalog/versions/:kind/:id/approve`） |
| `technology-selection` Agent（技術検索→適用条件整理→比較→草案） | 🟡 決定的Stepは完走確認済み。**構造化LLM StepはDeepSeek APIキー設定時のみ動作**（テスト環境ではLLM未設定として明示的に失敗することを確認） |
| `project-case-research` / `knowledge-quality` Agent | 🟡 決定的Step（施工実績検索）は完走確認済み。構造化LLM StepはDeepSeek APIキー設定時のみ動作（テスト環境ではLLM未設定として明示的に失敗することを確認） |
| WebUI「業務Agent（Agent Runs）」画面 | ✅ Agent一覧（用途・できないこと）、Run開始、Run監視（イベント・成果物）、成果物レビュー、Agent/Skill版の承認・取消 |
| P2（港湾・地盤・維持管理等の業務拡張）/ P3（専門システム連携） | ⏳ 実行不能なカタログのみ整備（`domain-packs/mirai-construction/backlog/p2-p3-catalog.yaml`。責任者・必要資料・評価条件・禁止事項を列挙。ADR-001参照） |

セットアップ（Domain Packの登録）:

```bash
node sync-agent-registry.mjs <Administratorのemail>            # domain-packs/ を draft（未承認）として同期
node sync-agent-registry.mjs <Administratorのemail> --approve  # 同期と同時に承認（運用者＝承認者の暫定運用）
node seed-agent-fixtures.mjs                            # 公開技術情報Fixtureを投入（冪等）
node ingest-sources.mjs <email> --kind technology       # 公式サイトの技術紹介ページを出典として取り込み（pending）
node manage-sources.mjs <email> list pending            # 出典のレビュー（approve / quarantine / retire）
npm run worker                                          # 別プロセスとしてWorkerを起動（ポーリング実行）
```

```bash
# Agent Runの起動例（Administrator/Developer/Reviewer/Approver/Knowledge Curatorのみ）
curl -X POST http://127.0.0.1:<PORT>/api/agent-runs \
  -H 'Content-Type: application/json' -b "session=<cookie>" \
  -d '{"agentId":"technology-selection","input":{"query":"汚濁防止膜の管理に関係する保有技術"}}'
```

## ✅ 実運用チェックリスト（運用整備 A-1〜A-7）

| # | 項目 | 手順 / コマンド | 確認方法 |
|---|---|:--|---|
| A-1 | 2 人目の実 Administrator / Approver を作成し、自己承認禁止（SoD）を実運用する | Users 画面「+ 新規ユーザー」→ 初期パスワードを本人へ安全に伝達 | 起案者と別人で Gate 承認できること（本人の承認は 403） |
| A-2 | 失敗 Run の残骸（重複草案）を整理する | 本番データ削除のため **Y/N 承認**のうえ SQL で削除（`artifact_citations` → `artifacts`） | `GET /api/agent-runs/:id` の artifacts が想定件数 |
| A-3 / A-4 | 各 Agent の実 Run を本番・MVP で 1 件ずつ完走確認 | `node create-agent-run.mjs <Administratorのemail> <agentId> '<入力JSON>' --wait`（MVP は `set -a; source .env.mvp; set +a` の上で実行） | `final: completed`、成果物 1 件、`requires_human_review=true` |
| A-5 | Worker 監視 | `GET /api/health` の `worker.alive` / `queue.backlog` / `degraded`。`systemd/mira-agent-os{,-mvp}-watchdog.timer` を有効化（5 分ごと。異常時は失敗終了して journal に WARNING） | `systemctl list-timers`、`journalctl -u mira-agent-os-watchdog` |
| A-6 | バックアップとリストア訓練 | `bin/pg-backup.sh`（`systemd/mira-agent-os-backup.timer` で毎日 03:15、保持 14 日）、`bin/pg-restore-drill.sh [mira_agent_os|mira_agent_os_mvp]`（使い捨て DB へ復元し件数確認後に削除）。両スクリプトはサーバーと同じ PostgreSQL 16 の `pg_dump` / `pg_restore`（`PG_BIN`、既定 `/usr/lib/postgresql/16/bin`）を使う。初回訓練 2026-09-09 実施済み | 直近 dump の存在と、訓練スクリプトの件数出力 |
| A-7 | 本チェックリストの維持 | 手順変更時に本節を更新 | — |

## 📚 出典（source_records）の取り込みと版管理（B-8〜B-12）

Agent が根拠にできるのは **承認済み（`approved`）かつ有効期限内** の出典だけです。取り込みは人が起動するバッチで行い、Agent には URL 取得の Tool を与えません。

| 手順 | コマンド | 備考 |
|---|:--|---|
| 公式サイトの技術紹介ページを取り込む | `node ingest-sources.mjs <運用者のemail> --kind technology [--dry-run] [--limit N]` | sitemap から詳細ページを列挙し 1 秒間隔で取得。`status='pending'` で保存（検索対象外） |
| 公式サイトの施工実績ページを取り込む | `node ingest-sources.mjs <email> --kind work` | 「地域／市区町村」（詳細な位置情報）と画像は保存しない。都道府県・発注者区分・竣工年は `attributes` に構造化 |
| 未承認の一覧 | `node manage-sources.mjs <email> list pending` または `GET /api/sources?status=pending` | 隔離（`quarantined`）された行は理由が `review_note` に入る |
| 承認 | `node manage-sources.mjs <Approverのemail> approve <id,id,...\|--all-pending>` または `POST /api/sources/:id/approve` | 取り込み者本人の承認は職務分離で 403。Approver が 1 人しかいない間は `--allow-self-review`（API は `allowSelfReview:true`）で例外承認でき、監査ログに `selfReviewException=true` が残る |
| 隔離 / 失効 | `manage-sources.mjs <email> quarantine <id> --reason "..."` / `retire <id> --effective-to YYYY-MM-DD` | 失効した出典は検索・引用検証の両方で除外される |
| 版の更新 | 同じ URL を再取り込み → 内容（SHA-256）が変わっていれば `version+1` の pending 行 → 承認で旧版が自動的に `superseded`（`effective_to`=当日） | 内容が同じなら `unchanged` で何も作らない |

検索は `title` / `summary` / `content_text` への部分一致（pg_trgm GIN index）で、相談文から英数字の技術名・カタカナ語・漢字語を取り出して照合します（`src/lib/search-tokens.js`）。社内基準（安全・品質・環境）は公開情報ではないため本バッチの対象外で、承認済み版の提供を受けてから `classification` を設計したうえで取り込みます。

## 🚧 既知の制約（本格実装スコープ）

- authentik / SSO 未統合。単一 email+password のみ
- Notion / Slack / Gmail / GitHub は実API連携なし（Integrations は状態を人が手動設定するのみ）
- Chat の実LLM応答は自然言語部分のみ。Intent分類・Risk推定・Idea構造化は常にルールベース
- Task の実行・完了は実際のAIエージェントが行わない（Retry/CancelはStatus更新のみ）
- 承認ステップは「ロール」ベースで割り当てる（正本のような特定個人への事前割当ではない）
- Agent/Skill版の承認は Runtime 内の版承認であり、正式なGate承認（desknet's NEO）とは別物。
  `--approve` 同期は運用者＝承認者の暫定運用（WebUI承認と使い分ける）
