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

## ⏸️ Run の承認拘束・一時停止・再開（C-13）

| 仕組み | 動作 |
|---|---|
| 承認ゲート | Skill の `execution.yaml` に `approval_gate: { required: true, role: Approver, reason: "..." }` を書くと、その Step の実行前にアプリ内承認（`approval_requests`, type `agent_run_step`）が必要になる。Run は `waiting_approval` で待ち、Worker を占有しない |
| 拘束 | 承認は Agent 版・Skill 版（内容ハッシュ）・Step・入力ハッシュに拘束される。承認後に版や入力が変われば承認は無効で再申請になる |
| 承認 | Approvals 画面の多段階承認と同じ。起案者本人は判定できない（職務分離）。承認で Run は自動的にキューへ戻り、却下で `cancelled` |
| 一時停止 | `POST /api/agent-runs/:id/pause`（画面の「一時停止」）。queued なら即時、running なら現在の Step を終えてから `paused` |
| 再開 | `POST /api/agent-runs/:id/resume`（「再開」）。起案者か Administrator のみ。承認済み版の存在と、承認待ちなら承認の確定を再検証してからキューへ戻す |

P1 の 3 Agent は A0〜A1（外部書き込みなし）のため既定ではゲートを設定していない。P2/P3 で外部への確定書き込み（A2）を追加する Skill に `approval_gate` を付ける。正式な業務承認（desknet's NEO）とは別のアプリ内承認である（ADR-001）。

## 🏢 組織責務 Agent 01〜09（第 2 段）

`org-map.yaml` の 9 組織それぞれに実行可能な Agent（`agents/*.yaml`、layer=organization、技術リスク T2〜T4）を定義し、共通 Skill 9 種を Agent 契約の `params` で再利用する。P1 の 3 Agent、土木専門 Agent 9 種（第 3 段）、相互レビュー Agent（第 4 段）と合わせて 22 Agent が Registry で承認・実行可能。

| 組織 | Agent | Skill（順に実行） | 主な入力 |
|---|---|---|---|
| 01 経営・統治・委員会 | governance-support | kpi-review → sod-check → decision-log-draft | query, options |
| 02 営業・案件形成 | sales-opportunity-support | knowledge-brief（実績・技術）→ planning-brief（proposal）→ decision-log-draft | query |
| 03 施工・調達・作業所 | construction-planning-support | knowledge-brief → quantity-consistency-check → planning-brief（construction_plan）→ risk-assessment（safety） | query, quantities_text |
| 04 技術・研究開発 | research-technology-support | knowledge-brief（技術・基準）→ planning-brief（research_or_poc）→ source-citation-verify → decision-log-draft | query |
| 05 安全・品質・環境 | safety-quality-environment-review（T4） | document-review（安全・品質・環境の観点）→ risk-assessment（safety）→ decision-log-draft | query, document_text |
| 06 管理本部・経営企画 | management-planning-support | kpi-review → quantity-consistency-check → planning-brief（business_plan）→ risk-assessment（ai） | query, quantities_text |
| 07 支店・営業所 | branch-support | regional-context → knowledge-brief → planning-brief（regional_overview） | query, branch |
| 08 船舶事業部 | vessel-operation-support（T4） | knowledge-brief → planning-brief（vessel_assignment）→ risk-assessment（marine） | query |
| 09 DX推進部（社外向け） | external-dx-support | regional-context（public_only）→ knowledge-brief（公開資料のみ）→ planning-brief（requirement_discovery）→ document-review（セキュリティ観点） | query, customer, document_text |

共通 Skill: knowledge-brief（決定的）/ planning-brief / document-review / risk-assessment（構造化 LLM、検証失敗は保留）/ decision-log-draft（常に「未決定」）/ kpi-review（実測のみ、業務 KPI は未登録と明示）/ sod-check / quantity-consistency-check（単位混在・合計不一致の機械検出）/ regional-context（データ境界）。すべて草案は人間レビュー必須で、決定・承認・制御は行わない。

## 🧭 司令塔（CTO Orchestrator）

| 項目 | 内容 |
|---|---|
| 入口 | 業務Agent 画面「司令塔に依頼」または `POST /api/orchestrations {request}`。ロール・同時実行・日次上限は Run 作成と同じ |
| 計画 | LLM が要求文とカタログから意図・リスク・必要な Agent・順序（依存）・各 Agent への相談文を JSON Schema 付きで作る（`src/agent-runtime/orchestrator.js`）。LLM 未設定時はルールベース（語の一致）。**選べるのは Registry で承認済み・実行可能な Agent だけ**で、候補（P2/P3）・未承認・カタログに無い提案は理由付きで却下し、勝手に別経路へ迂回しない。合う Agent が無ければ `blocked` で止まり人間の判断に渡す |
| 実行 | 依存が満たされた Step から Run を作り（Worker のポーリングと詳細 API で前進）、先行 Step の findings / unknowns を `prior_context` として渡す。各 Run の Policy / 承認待ち / 予算はそのまま効き、司令塔は上書きしない |
| 上限 | Step 数 `ORCHESTRATION_MAX_STEPS`（6、相互レビューは数えない）、費用 `ORCHESTRATION_BUDGET_USD`（2.0、配下 Run の合計）。超過時は未着手 Step を blocked にして `partial` で止める |
| 統合 | 全 Step 終了後、Agent ごとの帰属付きで事実・不明点・根拠を 1 つの統合草案（`orchestration_summary`、人間レビュー必須）にまとめる。失敗した Agent の結果は「結果なし」として不足を明示し、成功扱いしない。部分成功は `partial` |
| 記録 | 計画（選択理由・却下理由）と終了を監査ログに残し、Run / 成果物は `orchestration_id` で追跡できる |

土木専門 Agent（layer=civil_expert）は、選ばれた組織責務 Agent の `delegates_to` に含まれ、かつ要求文が専門 Agent の `keywords` に一致する場合だけ、その組織 Agent の後段（`depends_on`）として起動する（B-005）。専門 Agent を先頭に置く LLM 提案は却下理由付きで不採用。Step 上限の既定は 6。統合草案には配下 Step の最大技術リスク（`technical_risk_class`）と専門技術者レビューの要否が付く。

## 🔍 Cross Review（相互レビュー、第 4 段）

司令塔は成果の出る計画に、他の全 Step に依存する相互レビュー Step（`cross-review-agent`、layer=cross_review、T3）を最終 Step として必ず付ける（Step 上限に数えない）。相互レビュー Agent が Registry で未承認なら「未実施」を計画に残し、隠さない。

| 項目 | 内容 |
|---|---|
| 独立性（K-002 / K-017） | Model Router の `Independent Review` 分類で解決したモデルを使い、一次 Agent（Research / Classification）と分離する。同じ回答をそのまま追認せず、機械検査の結果を入力に「必ず疑って確認する」 |
| 機械検査（K-004〜K-006） | `machineCrossCheck`: Agent 間で同じ量（ラベル + 単位）の数値が異なれば **数値矛盾**、SI と ft / kN と tf / 座標系 / 基準面の混在は **単位矛盾**、sources の無い事実は **根拠なし** |
| 独立レビュー（K-007〜K-011） | 前提条件・出典・リスク評価の矛盾、根拠のない主張、少数意見（消さずに残す）、未確認事項、reasons を JSON Schema 付きで抽出 |
| 判定の強制（K-013 / K-014） | PASS / CONDITIONAL / FAIL + confidence。数値矛盾があれば FAIL、単位矛盾・根拠なしがあれば CONDITIONAL 以上で、LLM の判定は機械検査より緩められない。LLM 未設定・検証失敗時は機械検査のみで判定し、**PASS にはしない**。FAIL は `human_review_forced=true` で統合草案の `expert_review_required` を強制 |
| 部分成功 | 他 Step が失敗しても、成果のある Step だけを対象にレビューする。成果が無ければ skipped |
| Evidence（K-012 / K-016 / X-020） | 判定・confidence・矛盾・根拠なし・少数意見を成果物 `cross_review` に保存し、統合草案 `content.cross_review` と監査ログ `orchestration.cross_review` に残す。WebUI の司令塔詳細に判定を表示 |


## 🏗️ 土木専門 Agent 9 種（第 3 段）

`org-map.yaml` の `civil_experts` に列挙した横断層。部署に属さず、組織責務 Agent から委譲される。各 Agent は `technical_risk_class`（T1〜T6）、`required_conditions`（推測で補完してはならない条件）、`keywords`（司令塔のルーティング語）、`input_contract` を契約として持つ。

| Agent | T | 必要条件（無ければ「未確定」として登録） | Skill（順に実行） |
|---|---|---|---|
| port-marine-expert 港湾・海上 | T4 | 設計波・潮位・水深・地盤条件・施工時期 | condition-gap-register → standard-reference-check → knowledge-brief → applicability-gap-check → technology-comparison → engineering-consistency-check → evidence-backed-draft |
| geotechnical-expert 地盤 | T4 | N値・土質・地下水位・層厚・対象構造物 | 同上 |
| structural-expert 構造 | **T5** | 構造形式・荷重条件・材料・基準の版・地盤条件 | condition-gap-register → standard-reference-check → knowledge-brief → engineering-consistency-check → planning-brief（structural_review_points） |
| construction-planning-expert 施工計画 | T3 | 工種・数量・工期・施工条件・使用機材 | condition-gap-register → knowledge-brief → quantity-consistency-check → planning-brief（construction_sequence）→ risk-assessment（safety） |
| bim-cim-cad-gis-expert BIM/CIM・CAD・GIS | T2 | 座標系・基準面・単位・データ形式・対象範囲 | condition-gap-register → engineering-consistency-check → knowledge-brief → planning-brief（data_integration） |
| environmental-expert 環境 | T3 | 環境項目・対象地域・工種・施工時期・規制値 | condition-gap-register → standard-reference-check → knowledge-brief → applicability-gap-check → risk-assessment → evidence-backed-draft |
| maintenance-expert 維持管理 | T3 | 構造物種別・点検結果・劣化状況・供用条件・補修履歴 | condition-gap-register → knowledge-brief → applicability-gap-check → technology-comparison → evidence-backed-draft |
| quantity-cost-expert 数量・コスト | T3 | 数量表・単位・工種・単価の出典 | condition-gap-register → quantity-consistency-check → engineering-consistency-check → planning-brief（quantity_review） |
| civil-review-expert 土木レビュー | T4 | 対象成果物・前提条件 | engineering-consistency-check → standard-reference-check → document-review（数値・前提・出典・未確認事項） |

技術リスクの強制（`technicalRiskPolicy`）: Run 作成時に Agent 契約の T を `agent_runs.technical_risk_class` に固定し、その Run の全成果物に `expert_review_required`（T3 以上）と `ai_completion_prohibited`（T5/T6）を付ける。`POST /api/artifacts/:id/review` は T3 以上で `expert_confirmed: true`（Reviewer / Administrator のみ）を要求し、T5/T6 ではさらに `expert_note`（専門技術者の所見、10 文字以上）が無いとレビュー済みにできない。確認内容は監査ログに残る。

専門 Skill 3 種（決定的、推測しない）: condition-gap-register（必要条件の記載有無を照合。「不明」と併記された条件も未確定）/ engineering-consistency-check（SI とヤード・ポンド法、kN と tf、JGD2011 と JGD2000、T.P. と D.L. の混在を検出）/ standard-reference-check（承認済み出典の版・発行日・有効期限を追跡し、同一タイトルの複数版と社内基準の未登録を明示）。

## 💬 AI相談の IDEA 構造化と部署別カタログの照合

| 項目 | 内容 |
|---|---|
| 構造化 | 相談文と会話履歴から、対象業務・現状・期待効果・必要データ・リスク候補・確認が必要な点を **LLM が JSON Schema 付きで抽出**（`src/lib/chat-idea.js`。業務Agent と同じ schema 検証・Prompt Injection 対策・費用計上）。LLM 未設定 / 月次上限 / 検証失敗時はルールベース（シナリオ + 語の一致）へ戻し、`idea_json.source` で区別。未抽出のプレースホルダーは表示しない |
| 部署別カタログ | `domain-packs/mirai-construction/org-map.yaml`（組織 9 区分 × Agent）が正本。P1（実定義）と P2/P3（backlog 候補）を `src/agent-runtime/catalog.js` が統合し、`GET /api/agent-catalog/org` で承認状態付きで返す。部署別シート（docs）はこの表の配布用 |
| 近い Agent | 構造化カードに関係部署と近い Agent（実行可 / 候補）を表示。P1 で実行可なら「この Agent で実行」で相談原文を業務Agent の相談欄へ転記（人が確認して開始）。該当が無ければ「未登録 → 追加希望へ」と明示 |

## 📄 利用者向けの文書（G-35 / G-37 / G-38）

| 文書 | 用途 |
|---|---|
| Run 詳細の成果物カード（G-36） | 不明点・仮定を 1 項目ずつ「確認済み」にでき（`artifact_checks`、Audit 記録、本文は不変）、根拠の出典は「本文を見る」で取り込み時のスナップショットを表示、「公式ページ ↗」で原典へ |
| `docs/みらい建設工業_部署別Agent-Skill機能一覧.html` | 各部署が Agent／Skill を確認し、追加希望を記入して「名前を付けて保存」 |
| `docs/みらい建設工業_追加希望集計.html` | DX推進部が各部署のシート（JSON / HTML）を読み込み、追加希望を一覧化して重複を検出し、優先度・状態・担当を付ける。CSV / JSON 書き出し、「名前を付けて保存」 |
| `docs/業務Agentの使い方_1ページガイド.html` | 社員向けの 1 ページ説明（できること・できないこと・使い方・成果物の読み方・安全のしくみ・困ったとき） |
| `docs/P2-P3カタログ_部署レビュー会_議事テンプレート.html` | P2/P3 候補 Agent の部署レビュー会の議事テンプレート（評価観点と有効化チェックリスト） |

いずれも外部通信の無いスタンドアロン HTML で、入力はブラウザ内に保存される。

## 🔐 セキュリティ・ガバナンス（F-30〜F-34）

| # | 対策 | 内容 |
|---|---|---|
| F-30 | 監査ログの SHA-256 化と日次アンカー | 新規行は `hash_version=2`（SHA-256）で連結し、旧行（32bit 簡易ハッシュ）は再署名せず版付きで検証する。並行追記は advisory lock で直列化。`audit-anchor.mjs`（`systemd/mira-agent-os-audit-anchor.timer`、毎日 03:30）が直前アンカー以降のチェーンを検証し、末尾を `audit_anchors` と DB 外の追記専用ファイル（`AUDIT_ANCHOR_DIR`）に固定する。`GET /api/audit/verify` はチェーンとアンカーの両方を検証し、改変・削除を検出する |
| F-31 | CSRF 対策 | 更新系 API（POST / PATCH / PUT / DELETE）で Origin（または Sec-Fetch-Site）を自ホスト（`x-forwarded-host` 対応）と照合し、不一致は 403。Cookie は SameSite=Lax。Origin の無い非ブラウザ要求（CLI / テスト）は Cookie が付かないため対象外 |
| F-32 | レート制限 | ログイン: IP あたり 30 回 / 10 分、email あたり失敗 5 回 / 15 分で一時ロック（正しいパスワードでも 429）。Run 作成: 利用者あたり日次 50 件（`AGENT_RUN_MAX_PER_USER_PER_DAY`）に加え、同時実行上限（C-14） |
| F-33 | 依存関係の定期監査 | CI の `npm audit --audit-level=high` に加え、`.github/dependabot.yml` で週次の更新 PR。更新 PR も通常の品質ゲート（CI + Y/N）を通す。緊急の脆弱性は Critical / High ゼロを満たすまでマージしない。メジャー更新（express / js-yaml / pg / ajv）は自動 PR の対象外とし、別タスクで移行する（2026-09-09: express 5 と js-yaml 5 は互換性のため見送り） |
| F-34 | テスト DB ガード | E2E は DB 名 `mira_agent_os_test[_suffix]` かつロール `mira_agent_os_test_app` のみで起動し、本番 / MVP の DB 名は明示的に拒否する（`src/lib/test-db-guard.js`） |

監査ログは「暗号学的に改ざん不能」ではなく「改変・削除・後追い書き換えを検出できる」仕組みである。アンカーファイルはバックアップ先と同じディレクトリに置き、日次バックアップに含まれる。

## 🔗 外部連携の基盤（D-20〜D-24）

| 項目 | 内容 |
|---|---|
| 接続状態 | Integrations 画面は環境変数の有無（`src/integrations/connectors.js`）と「接続確認（読み取り専用）」の結果で状態を決める。手動で connected にする手段は無い。未設定の連携は `未設定（必要な環境変数）` と表示 |
| 正式承認参照 | 承認詳細で desknet's NEO の承認番号を「控える」ことができるが、常に **未検証** で保存され、承認の成立には使わない。検証は NEO 連携の仕様確認後に実装（現在は 501 blocked） |
| AI相談 → 業務Agent | 相談の構造化カードの「業務Agent で技術候補を比較」で `technology-selection` の相談欄へ転記（人が確認して開始） |
| 仕様案と確認事項 | `docs/architecture/外部連携仕様案_D20-D23.md`。外部接続・書き込み・production secret はすべて Approval PR 対象 |

## 🔀 モデル多重化と Model Router（C-19）

| 項目 | 内容 |
|---|---|
| Provider | `deepseek`（既定）/ `openai` / `anthropic`。既定は従来どおり `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL`。追加 Provider は `LLM_OPENAI_API_KEY` / `LLM_ANTHROPIC_API_KEY`（+ `_MODEL`、`_PRICE_*`）で有効化 |
| Model Router | エージェント設定画面の Model Router（`model_router`: category → モデル名）を業務Agent が実際に参照する。Skill 契約の `model_category`（`execution.yaml`、既定 `Research / Classification`）で category を選ぶ |
| 解決 | モデル名 → Provider / モデル ID は `src/lib/model-catalog.js`（DeepSeek-V3 → deepseek、Claude Opus / Sonnet → anthropic、Codex → openai）。API から呼べない名前（Claude Code / DeepSeek Harness）や API キー未設定の Provider は既定 Provider へフォールバックし、理由を表示・記録する |
| 記録 | 各 LLM 呼び出しを `run_events`（`llm_call`: Provider / モデル / category / フォールバック理由 / トークン / 費用）に残し、Run 詳細に表示。月次上限は全 Provider 合算 |
| AI相談（Chat） | 既定 Provider を使う（Model Router の対象外） |

Anthropic は JSON モードを持たないため、構造化出力はプロンプトの指示と JSON Schema 検証（不適合なら再試行 → 縮退）で担保する。

## 🛡️ Prompt Injection 対策（C-18）

出典本文・Tool 応答・利用者入力は「データ」であり「指示」ではない、を実装で保証する（`src/agent-runtime/prompt-guard.js`）。

| 層 | 対策 | 検証 |
|---|---|---|
| 取り込み | `source-normalize` が指示文（指示の無視・役割変更・ポリシー改変・秘密の要求・持ち出し）と秘密らしき文字列を検出したら `quarantined` にし、人が確認するまで検索対象にしない | E2E / 評価ケース SN-01 |
| LLM 入力 | 制御文字・ゼロ幅文字・双方向制御文字を除去し、`<untrusted_data>` で囲んで「従わない」ことを system / user prompt で明示。指示文の疑いは `run_events`（`injection_suspected`）に記録 | provider-adapter テスト |
| LLM 出力 | JSON Schema 検証（余分なフィールドは不採用）→ 草案は `requires_human_review=true` を固定、根拠はその Run で検索・検証された出典に限定、秘密らしき記述・指示文は除去して `unknowns` に明記。強制した事実は `policy_enforced` に記録 | ユニット + E2E（乗っ取られた出力を再現） |
| 権限 | LLM は Tool を直接呼べない（Tool は Skill 実装だけが呼び、Policy Engine が許可リストで判定）。`shell.exec` / `http.fetch` / `external.send` 等はグローバル禁止 | policy-engine テスト |

判定は決定的で、LLM に自己採点させない。パターンに無い新手の指示文は検出できないため、最終防御は「人手レビュー必須」と「根拠の範囲制限」である。

## 📈 業務Agent の実測 KPI（C-17）

監視（Observability）画面は **実測のみ** を表示する（以前の期間係数による換算値と架空の API p95 は廃止）。`GET /api/agent-runs/metrics?range=24h|7d|30d|all` が `agent_runs` / `run_events` / `artifacts` / `chat_messages` を集計する。

| 指標 | 定義 |
|---|---|
| 完走率 | completed / total（期間内に作成された Run） |
| 平均費用 / 合計費用 | run_events の cost 合計（LLM 実請求ではなく単価からの概算） |
| 平均所要 | completed の作成〜完了の平均秒 |
| レビュー率 | レビュー済み草案 / 草案 |
| 縮退 | `llm_degraded` の回数（LLM 出力を採用できず保留した回数） |
| AI 費用（期間内） | Run の費用 + AI相談の費用 |

設計文書の「成果測定」（人手作業時間との差・専門家修正量）は、レビュー時の入力がまだ無いため表示しない。

## 🧪 Skill 評価ランナー（C-16）

| 手順 | コマンド | 備考 |
|---|:--|---|
| 全 Skill を評価（費用ゼロ） | `node evaluate-skills.mjs [--email <実行者>]` | 各 Skill の `evals/cases.jsonl` を実行し、output schema と期待値（`<field>_min` / `_max` / `_equals` / `_includes`、`requires_human_review`）で合否判定。LLM はスタブ、検索 Tool は接続先 DB の承認済み出典を読む。Run・成果物・イベントは作らない |
| 実 LLM で評価 | `node evaluate-skills.mjs --live --skill technology-comparison` | DeepSeek を呼ぶ（費用が出る）。Skill 改訂前後の品質比較用 |
| 改訂前後の比較 | `node evaluate-skills.mjs --compare` | 直近 2 バッチを内容ハッシュと合否で比較し、回帰（前回合格 → 今回不合格）と改善を表示 |
| API | `GET /api/skills/:id/evaluations`、`GET /api/skills/:id/versions`（`eval_passed/eval_total`） | Registry 画面の「評価」列に内容ハッシュ一致の最新結果を表示 |

CI（app-ci）の E2E で全 Skill の offline 評価が実行され、失敗すれば PR がマージできない。LLM による自己採点は合否に使わない（設計文書 §評価）。

## 🧾 成果物の差分・履歴・版固定（C-15）

| 仕組み | 内容 |
|---|---|
| 系譜 | 同じ Agent・種別・入力（`input_hash`）の成果物は前回 → 今回と結ばれ（`previous_artifact_id`, `lineage_version`）、Run 詳細の成果物カードに前回との差分（確認できた事実 / 不明点 / 仮定 / 根拠の追加・削除）を表示する |
| 再実行 | Run 詳細の「同じ入力で再実行」（`POST /api/agent-runs/:id/rerun`）。終了した Run のみ。作成の検証・上限・監査は通常の作成と同じで、`rerun_of_run_id` に元 Run を残す |
| 書き直し履歴 | 同一 Run 内で草案が書き直されると（Step の再試行等）、直前の内容を `artifact_revisions` に残す。`GET /api/artifacts/:id/history` で系譜と履歴を取得 |
| 版固定 | レビュー済みにした時点の内容ハッシュを `reviewed_content_hash` に固定。以後の書き込みは拒否され、内容が変わっていれば `integrity=false`（画面に ⚠）で検出する |
| 差分 API | `GET /api/artifacts/:id/diff[?against=<id>]`（既定は系譜の直前） |

## 🔀 並行実行制御（C-14）

| 制御 | 内容 |
|---|---|
| 利用者あたりの同時実行 | `AGENT_RUN_MAX_ACTIVE_PER_USER`（既定 2）。queued + running を数え、承認待ち・一時停止は数えない。超過は 409 で理由を返す。利用者単位の advisory lock で同時要求の割り込みを防ぐ |
| 環境全体の同時実行 | `AGENT_RUN_MAX_ACTIVE_TOTAL`（既定 10）。LLM 費用と Worker 負荷の上限 |
| Worker 複数化 | 1 プロセス 1 Run。増やす場合は `systemd/mira-agent-os-worker.service` を複製して起動する（`FOR UPDATE SKIP LOCKED` で同じ Run を二重に取らない） |
| Lease | `AGENT_WORKER_LEASE_SECONDS`（60）内に heartbeat が無い running Run は別 Worker が引き継ぐ（`lease_reclaimed` イベント）。Lease を失った Worker は以後その Run に書き込まない |

API と運用 CLI（`create-agent-run.mjs`）は同じ `createRunForUser` を通るため、検証・上限・監査は共通。

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
