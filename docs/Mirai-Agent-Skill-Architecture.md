# Mirai AI Agent Business Platform — Agent／Skill機能設計案

調査日：2026-09-08（Asia/Tokyo）  
対象：`Kensan196948G/Mirai-AI-Agent-Business-Platform`  
確認コミット：`e173ecc6d544b8f762bbaa5bf0bed26da63a293c`

> 共通化するのは実行・統制、専門化するのは知識・手順・評価、最終判断を担うのは業務・専門の所有者。

この文書は、公式サイトとリポジトリ主要実装の静的確認に基づく設計提案である。実環境の起動、DB接続、API疎通、テスト実行、全ソースの網羅監査、本番変更は実施していない。公開技術紹介は製品・工法の概要であり、施工承認用の技術基準、完全な適用条件、内部API仕様ではない。

## 1. 結論と導入境界

既存の`app/`を共通実行・統制の中核として拡張し、`Mirai Construction Domain Pack`を追加する。初期対象は「施工実績検索・比較」「保有技術の候補整理」「Knowledge品質レビュー」の3Agentとする。

Agentの人数を増やすのではなく、確認可能な成果物を安全に作れる経路を増やす。技術名や部署名ごとに常駐Agentを作らない。たとえばMC-Float Naviは技術カタログの知識レコードであり、それ自体をAgentやSkillにする必要はない。

今回の設計は既存`app/`の拡張提案であって、既存SaaSの全面置換、別リポジトリへの機能吸収、設備自動制御、本番自動承認を意味しない。

## 2. 確認できた現在地

| 対象 | 確認内容 | 設計への反映 |
|---|---|---|
| `README.md` | SaaS中心が原則。`app/`は2026-09-08以降の明示的例外 | 方針変更の範囲をADRに記録し、全面リプレースしない |
| `app/README.md` | Node.js／Express／pg、PostgreSQL、認証・案件・承認・Knowledge・タスク画面がある | 現行構成を再利用する。別DB・別フレームワークへの移行を前提にしない |
| `routes/platform.js` | Agents／Skills／Routerは設定台帳。実Agent実行・外部同期は行わない | Registryを実行可能なバージョン付き定義へ拡張 |
| `routes/tasks.js` | 実行ログの作成・状態更新。Workerの実処理ではない | 永続ジョブ、実行試行、停止・再開・結果確認を実装 |
| `lib/llm.js` | AI相談用のDeepSeek呼び出しがある | 既存Chatは保ち、業務実行用のProvider Adapterを分離 |
| `routes/approvals.js` | 順序付き承認がある一方、確認範囲では申請者本人の承認禁止チェックがない。Administratorのロール代替が可能 | SoD、承認対象ハッシュ、実行直前の承認検証を追加 |
| `routes/knowledge.js` | 候補の登録・昇格・却下とNotion参照を保持 | 根拠、版、レビュー証跡、有効期限を備えた公開プロセスへ |
| `lib/audit.js` | 32bitの簡易ハッシュによる連結。暗号学的な改ざん防止ではない | 監査を過大評価しない。版付き強化、並行追記制御、外部検証可能性を設計 |
| `test/e2e.test.mjs` | テーブルDROPを実行。URL全体に`test`があるかでガード | 使い捨てDB、接続先の厳密検証、専用資格情報で事故を防ぐ |

現在の設定台帳を「未実装だから削除」するのではなく、既存UI・データ・APIとの互換を持つ投影として活かす。

## 3. 正本と責任分担

| 領域 | 正本／役割 | 本基盤の役割 |
|---|---|---|
| 正式な業務・Gate承認 | desknet's NEO Workflow | 検証済み承認結果の参照と実行への拘束 |
| 案件・Phase・KPI | AppSuite | 共通案件IDによる状態控え、実行との対応 |
| 確定Knowledge | 人間レビュー済みNotion | 参照権限と版を維持した検索用スナップショット |
| 検討・相談・レビュー | Slack | 通知・議論。Slackの「OK」を正式承認に変換しない |
| ソースコード・Skillパッケージ | GitHub | PRレビュー、版管理、評価、リリース |
| 実行・停止・証跡 | 既存`app/`の拡張 | Worker、Tool Gateway、成果物、使用量、監査 |

アプリ内レビューと正式承認を分ける。NEOの承認番号を手入力しただけでは本番実行の許可にしない。NEO連携方法が未確認なら、正式承認を要する動作は`blocked`とし、未接続を成功表示しない。開発用Mockは本番で受理しない。

役割は個人名で固定しない。業務所有者＝成果と用途、技術所有者＝技術知識・評価基準、安全品質環境担当＝高リスク審査、IT/DX＝実行基盤・セキュリティ、Knowledge Curator＝知識ライフサイクルを担当する。作成者と正式承認者を分離する。別モデルによるレビューだけでは人間の職務分離を満たさない。

## 4. 概念モデル

| 概念 | 意味 | 例 |
|---|---|---|
| Agent | 目的と限定権限を持ち、複数Skillを使って成果物を作る実行主体 | 技術選定支援Agent |
| Skill | 特定作業の手順、入出力契約、制約、評価例をまとめた再利用単位 | 工法の適用条件・不足情報を整理する |
| Tool | サーバー側で認証・認可された具体的機能 | 承認済み技術カタログの検索 |
| Knowledge | 根拠となる事実、規程、実績、技術資料 | CPG工法の公式概要、技術者承認済み適用資料 |
| Workflow | 実行順序、承認、停止、再開を管理する状態機械 | 検索→比較→レビュー→承認済み登録 |
| Policy | 実行を許可・保留・拒否する強制規則 | 未承認Skillの拒否、案件越境の拒否 |
| Human Owner | 技術判断・正式承認・成果受入れの責任者 | 対象部門の責任者、技術専門家 |

Agent＝部長、Skill＝部下という階層ではない。複数Agentが同じSkillを共有し、同じAgentが案件に応じて必要なSkillだけを使う。

## 5. 全体構成

```text
既存WebUI／承認済み入口
  ↓ 認証・案件権限・データ分類・予算確認
受付／Workflow選択（初期は明示選択＋決定的ルーティング）
  ↓
共通Agent Runtime
  ├─ Agent／Skill Registry（承認済み版を固定）
  ├─ Planner（承認済みテンプレート内の限定的計画）
  ├─ 永続ジョブ／Worker／実行試行／Checkpoint
  ├─ Policy／Approval Binding／SoD
  ├─ Model Provider Adapter／使用量・予算予約
  └─ Tool Gateway（具体的操作ごとに再認可）
       ↓                    ↓
Mirai Domain Pack       既存SaaS・専門システムAdapter
       ↓                    ↓
成果物＋根拠＋不足情報＋評価＋実行証跡
       ↓
人間レビュー／必要な正式承認／成果測定
```

初期は既存ExpressとPostgreSQLを使うモジュラーモノリス＋別Workerプロセスを第一案とする。マイクロサービス、Kubernetes、ベクトルDB、外部Agentフレームワークの導入は必須条件としない。既存検索・実行・権限ライブラリがある場合は先に再利用を検討する。

分散化する前に、再送、Worker停止、重複イベント、承認後の変更、外部処理の成否不明を正しく扱う。

## 6. 事業・技術から導くAgentカタログ

以下は提案であり、実装済み機能ではない。P1以外は、評価資料・利用権限・業務責任者が揃ってから有効化する。

| ID | Agent | 主なSkill候補 | 主成果物 | 推奨Owner／段階 |
|---|---|---|---|---|
| A01 | 施工実績・提案支援 | 実績検索、類似条件比較、提案根拠整理、能力説明草案 | 出典付き実績比較表・提案草案 | 営業・施工／P1 |
| A02 | 技術選定・比較支援 | 技術検索、適用条件整理、不足条件抽出、比較表作成 | 技術候補・不明点・要確認条件 | 技術／P1 |
| A03 | 港湾・海上施工計画支援 | 浚渫・埋立・護岸等の計画論点整理、工程制約抽出、承認済み気海象情報の鮮度確認 | 計画レビュー用チェック表 | 施工・港湾技術／P2 |
| A04 | 地盤改良支援 | 地盤条件の欠落確認、CPG等の候補比較、品質記録チェック | 工法候補比較・照査事項 | 地盤技術／P2 |
| A05 | 陸上土木・防災復旧支援 | 造成・道路・橋梁・復旧工事の条件整理、仮設・施工順序の確認 | 計画草案・制約一覧 | 土木施工／P2 |
| A06 | 維持管理・補修支援 | 点検記録整理、補修工法比較、再点検事項抽出 | 補修検討・点検計画草案 | 維持管理技術／P2 |
| A07 | エネルギー施設建設支援 | 風力等の建設実績比較、施工インターフェース・搬入条件の整理 | 建設計画・技術提案の草案 | 対象事業の責任者／P2 |
| A08 | 安全・品質・環境レビュー支援 | 承認済み基準との照合、点検漏れ検出、KY草案、不適合の整理 | 指摘一覧と根拠・確認依頼 | 安全品質環境／P2 |
| A09 | サステナビリティ支援 | 活動データの単位検証、排出量集計補助、証跡チェック、報告草案 | 根拠付き活動集計・報告案 | 環境・経営企画／P2 |
| A10 | 船舶・機械運用支援 | 保守記録整理、匿名化・集約済み警報記録の要約、点検予定案 | 保守・改善案 | 船舶・機電／P3 |
| A11 | 研究・技術継承支援 | 技術比較、調査課題整理、承認済み事例教材化、評価観点作成 | 研究検討メモ・教材候補 | 技術・研究・教育／P2 |
| A12 | Knowledge品質支援 | 根拠確認、重複判定、品質レビュー、有効期限確認、改訂提案 | レビュー用候補・差分・根拠 | Curator＋専門Owner／P1 |

エネルギー領域は「設備の建設支援」であり、発電制御・電力取引へ勝手に広げない。財務・契約・調達等の汎用企業業務は、現行SaaSと権限を確認した別拡張とする。

### 初期実装する12Skill

| Skill ID | 機能 | 主実行方式 |
|---|---|---|
| `source-normalize` | 許可された公開資料／合成データの正規化、除外対象検査、隔離 | 決定的処理中心 |
| `source-citation-verify` | 出典、版、引用箇所、参照権限の検証 | 決定的処理＋必要な人間確認 |
| `project-case-search` | 承認済み施工実績の検索 | 許可された検索Tool |
| `case-comparison` | 類似・相違・不明条件の比較 | 構造化LLM出力＋スキーマ検証 |
| `technology-catalog-search` | 承認済み技術カタログの検索 | 許可された検索Tool |
| `applicability-gap-check` | 適用条件、不足情報、適用不能の根拠を分離 | 構造化LLM出力＋専門評価 |
| `technology-comparison` | 技術候補の比較表作成 | 構造化LLM出力 |
| `evidence-backed-draft` | 根拠付き成果物草案作成 | 構造化生成＋引用検証 |
| `knowledge-quality-review` | 正確性・具体性・再利用性・機密性のレビュー支援 | ルール＋LLM支援 |
| `knowledge-dedup` | 重複候補検出。矛盾を重複と混同しない | 検索＋比較 |
| `knowledge-review-packet` | 人間レビュー用の根拠・差分・未解決事項をまとめる | 決定的整形＋生成 |
| `outcome-measurement` | 実測された作業時間、利用量、人間修正等の集計 | 決定的処理 |

`source-normalize`の隔離結果はRAG検索対象にしない。成果物のKnowledge昇格やNotion書き込みは、このSkill一覧だけで自動許可されるものではない。

## 7. 会社固有技術との接続境界

公式サイトにはMC-Float Navi、MC-Caisson、MC-Wake、MC-Gats、港湾ICT、CPG、維持管理・環境技術等が掲載されている。各技術を知識レコードにし、共通の比較・適用条件確認Skillから使う。

| 技術例 | AIで追加する補助機能 | 今回追加しない機能 |
|---|---|---|
| MC-Float Navi | 技術説明、適用検討、許可済み集約記録のレビュー | 侵入禁止範囲・発報条件の自動変更 |
| MC-Caisson | 出来形帳票の確認支援、記録の説明・比較 | ポンプ・注排水・位置誘導の直接制御 |
| MC-Wake | 警告記録の説明、確認事項の整理 | 航跡波警報の抑制・代替・解除 |
| CPG工法 | 公開概要の検索、適用条件の不足情報整理 | 公開紹介だけを根拠にした施工設計・工法確定 |

MC系システムのAPI、CSV出力、認証、接続契約は未確認である。架空のAPIを作らない。将来の連携でも、仕様と権限が確認できた読み取り専用Adapterから開始する。位置情報は初期入力・外部AI送信の対象外とする。

## 8. Skillパッケージ設計

Agent Skills形式の`SKILL.md`と、業務アプリ独自の実行契約を分離する。

```text
domain-packs/
  mirai-construction/
    pack.yaml                    # 独自仕様：責任者・適用範囲・有効版
    agents/
      project-case-research.yaml # 独自仕様：業務Agent定義
      technology-selection.yaml
      knowledge-quality.yaml
    skills/
      applicability-gap-check/
        SKILL.md                 # Agent Skillsの標準形式
        execution.yaml           # 独自仕様：実行側が強制する契約
        schemas/
          input.schema.json
          output.schema.json
        references/
          source-index.json      # 出典の索引。知識正本の代替ではない
        assets/
          comparison-template.md
        evals/
          cases.jsonl
```

`SKILL.md`の例：

```yaml
---
name: applicability-gap-check
description: 承認済み技術資料と案件条件を照合し、適用候補、不足条件、要専門家確認事項を根拠付きで整理する。技術選定の事前検討に用い、施工可否の最終承認は行わない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---
```

本文では、対象作業、適用しない作業、必要な入力、手順、失敗・保留条件、出力形式、根拠、レビュー事項を定義する。

`execution.yaml`の独自仕様例：

```yaml
schema_version: mirai.skill-execution/v1
skill_id: applicability-gap-check
version: 1.0.0
input_schema: schemas/input.schema.json
output_schema: schemas/output.schema.json
required_source_state: approved
source_scope: authorized_project_and_public
allowed_tools:
  - knowledge.search-approved
  - source.read-approved-snapshot
  - artifact.write-draft
forbidden_actions:
  - equipment.control
  - external.send
  - formal-approval.decide
result_class: draft
require_domain_review: true
on_missing_evidence: abstain
max_attempts: 3
```

この例のフィールドはAgent Skillsの標準項目ではない。検証器と実行器を本アプリ側に実装する。`source_scope`は概念値であり、認証済み利用者の案件権限をサーバー側で計算する。LLMやクライアントから受け取った案件IDをそのまま信用しない。

### 読み込みと実行

起動時はSkill名・説明・版等の最小メタデータを読み、対象を選択した時点で本文、その後に必要な参照資料だけを読む。全Skill本文を毎回プロンプトへ注入しない。

実行は「発見→承認済み版の選択→依存・ハッシュ確認→入力検証→案件権限とデータ分類検証→限定Tool呼び出し→出力検証→根拠確認→成果物保存」の順で行う。

`SKILL.md`の文字列や`allowed-tools`だけをセキュリティ境界にしない。最新版Claude Codeの`allowed-tools`は事前許可であり、利用可能Toolをその一覧だけに制限するものではない。業務アプリでは独立したサーバー側PolicyとTool Gatewayが必要である。

### Claude Codeとの区別

`.claude/agents/`と`.claude/skills/`は開発を支援するClaude Code用構成である。そこにファイルを置くだけでWebアプリの社員向けAgentが動くわけではない。

業務用は`domain-packs/`＋アプリのRuntimeとする。共通Skillを両方で使う場合も、正本を一つにし、生成・配布手順と整合性チェックを作る。開発用権限やBash実行能力を業務Runtimeへ継承させない。

## 9. データ整備と根拠管理

初期検証は公開・利用許諾済み資料のうち個人情報・位置情報を除いた内容と合成データに限定する。社外秘、個人情報、位置情報、秘密鍵、認証情報は入力・外部AI送信しない。文書本文だけでなく、ファイル名、URL、メタデータ、ログ、例外、検索クエリからの漏えいも検査する。

```text
許可された資料
  → 取得・利用条件確認
  → 正規化／ナビゲーション等の除去／表記ゆれ・単位・日付の整理
  → 個人情報・位置情報・社外秘等の除外／不明なものの隔離
  → 重複候補・矛盾・旧版を検出
  → 原文箇所と根拠の対応を確認
  → 人間の品質・専門レビュー
  → 確定Knowledge（Notion正本）
  → 権限と版を持つ承認済み検索インデックス
```

矛盾や旧版を黙って削除せず、履歴・無効化理由・置換先を記録する。公開されていることと、技術基準として十分であることを区別する。検索に混ぜるのは承認済みの知識だけとし、Slack生ログ、未確認草案、試験用合成知識を本番検索へ入れない。

SourceRecordの主な属性：`source_id`、`canonical_url`、`title`、`source_type`、`evidence_type`、`published_at`、`fetched_at`、`effective_from/to`、`content_hash`、`version`、`reviewer_id`、`reviewed_at`、`classification`、`project_scope`、`license_or_permission`、`supersedes`。

公開技術紹介は`marketing_overview`等の根拠種別を明記する。現場条件、設計限界、歩掛、停止基準、保証性能を補完推測しない。会社概要上の認証も、除外範囲等の注記を失わせない。

RAGの権限チェックは検索前に実施し、取得・キャッシュ・成果物ダウンロードでも再確認する。候補レビュー用Toolと承認済み知識検索用Toolは分離する。

## 10. 実行・権限・分散処理

### 実行レベル

| レベル | 許可する範囲 | 初期方針 |
|---|---|---|
| A0 | 説明・要約・候補整理 | 可 |
| A1 | 承認済み検索、限定計算、ローカル草案作成 | 可 |
| A2 | 正式承認に拘束された対象限定の外部書き込み | 連携仕様・承認検証・受入完了後のみ |
| A3 | 設備・船舶制御、安全警報の変更、無承認の本番変更 | 今回の対象外 |

これは提案する自律性分類であり、既存のリスク体系R0〜R5を置き換えない。R0〜R5の定義は現行文書と照合し、未定義動作は拒否する。

### Approval Binding

承認は`project_id / task_id / action / target / arguments_hash / artifact_hash / skill_version / policy_version / expires_at`等に拘束する。対象、送信先、内容、Skill、権限条件が変われば再承認する。実行直前に有効性、承認取消、SoDを再検証する。

### 永続実行

APIが受けたタスクをDBへ永続化し、Workerが取得する。Lease、Heartbeat、Checkpoint、試行IDを持たせる。DBトランザクションを保持したままLLMや外部サービスの応答を待たない。

配信は少なくとも1回を前提とし、冪等キー、Outbox、実行効果台帳、照合・復旧を組み合わせる。外部サービスの副作用まで一律にexactly-onceと保証しない。外部送信の直後にWorkerが停止した場合は、成否不明として照合し、無条件の再送は行わない。

初期の設定候補：実行当たり最大8Step、同一Step最大3Attempt、進展なし3回で停止、利用者当たり並行2Run。上限は設定可能にし、業務別評価で調整する。予算は同時実行も考慮して予約・精算し、上限未確認で際限なくLLMを再呼び出ししない。

キャンセルはUIの状態変更だけでなく、Workerの中断要求と確認を扱う。既に発生した外部副作用は取消済みと偽装しない。承認待ち中はWorkerを占有せず、再開時に現在の権限・データ版・承認を再検証する。

### Tool Gateway

任意のShell、PowerShell、SQL、URL、動的JavaScriptをLLMに実行させない。登録済みの型付きToolと認証済みAdapterだけを許可する。Skill付属スクリプトは自動実行しない。将来必要ならレビュー済みの固定Entry Pointと隔離環境、資源上限を別途設計する。

Web取得を行う場合は許可ドメイン、リダイレクト再検証、内部IP拒否、最大サイズ、タイムアウト等を持たせる。入力文書、Tool応答、検索結果、Skill本文に含まれる「承認を省略せよ」等を権限命令として扱わない。

## 11. 既存実装への追加候補

```text
app/src/agent-runtime/
  registry.js
  skill-loader.js
  workflow-engine.js
  policy-engine.js
  tool-gateway.js
  approval-binding.js
  job-store.js
  worker.js
  provider-adapter.js
  evidence-validator.js
  evaluation-runner.js
app/src/integrations/
  knowledge-adapter.js
  approval-adapter.js
  project-ledger-adapter.js
app/src/routes/
  agent-runs.js
  artifacts.js
```

配置とファイル名は提案であり、現行構造を確認して調整する。

| 既存資産 | 拡張方針 |
|---|---|
| `agents_config` | 既存カタログの表示を維持し、版付き定義・所有者・許可範囲を紐付ける |
| `skills_registry` | Skillの不変バージョン、内容ハッシュ、承認履歴、評価結果を追加 |
| Agentの`skills`文字列 | Agent版×Skill版の関連に正規化し、旧表示には投影する |
| `tasks` | 手動台帳とRuntime管理Runを識別する。実行状態はRuntimeだけが更新 |
| `task_tool_calls` | 引数・結果の参照、判定Policy、実行結果、冪等キーを記録 |
| `approval_requests` | アプリ内レビューと正式承認参照を区別し、対象と版を拘束 |
| `knowledge_candidates` | 根拠、版、レビュー、昇格先を追加。状態だけの昇格を廃止 |
| `audit_log` | 版付き強化、並行追記制御、機密を含めない証跡 |

追加候補は、`skill_versions`、`agent_versions`、`agent_skill_bindings`、`task_attempts`、`skill_runs`、`run_events`、`artifacts`、`artifact_citations`、`source_versions`、`knowledge_reviews`、`approval_bindings`、`effect_ledger`、`budget_reservations`等。全テーブルを機械的に追加するのではなく、既存の責務に統合できるものは統合する。

API候補：

```text
POST /api/agent-runs                 許可されたAgent／Workflowを起動
GET  /api/agent-runs/:id              現在状態・版・根拠・使用量
GET  /api/agent-runs/:id/events       実行経過
POST /api/agent-runs/:id/cancel       中断要求
POST /api/agent-runs/:id/resume       条件を再検証して再開
GET  /api/artifacts/:id              草案／レビュー状態／根拠
GET  /api/skills/:id/versions         版・承認・評価結果
```

これらは新規提案であって現存APIではない。既存`PATCH /api/tasks/:id`からRuntime管理タスクの完了・承認待ち・費用・実行結果を偽装できないようにする。互換を残すのは正当な用途であり、安全性の抜け穴ではない。

## 12. UI設計

既存画面を段階拡張し、社員にAgent名やTool名を覚えさせない。「施工実績を探す」「技術候補を比較する」「Knowledgeをレビューする」を入口とする。

Agent詳細には用途・できないこと・所有者・状態を、Skill詳細には版・根拠・入力・出力・評価・許可Toolを表示する。Run詳細には現在Step、承認待ち理由、実際に使ったモデル、使用量、停止・再開状況を表示する。成果物には「草案／レビュー済み／正式承認済み」を別々の状態として示す。

接続状態は「未接続／Mock／疎通確認済み／同期済み」を混同しない。管理者の手動編集時刻を「同期成功時刻」として扱わない。LLM障害時にルールベースで返す既存Chatは維持できるが、業務Agentの失敗を成功したAI成果と表示してはならない。

## 13. 代表ユースケース

入力例：個人情報・位置情報を除いた案件条件として「汚濁防止膜と作業船の管理に関係する保有技術を整理したい」。

1. 利用者と案件権限を検証し、許可済みの技術比較Workflowを選択する。
2. 技術選定Agentが承認済みカタログを検索する。
3. MC-Float Navi等の技術概要を取得し、検索対象資料の版を固定する。
4. `applicability-gap-check`が確認済み事項と、未確認の接続仕様・現場条件を分離する。
5. `technology-comparison`が目的別の比較表を作成する。警報機能の相違を同一視しない。
6. 引用検証を実行し、専門家確認事項付きの草案を保存する。
7. 人間がレビューし、必要な正式承認へ進める。レビュー済み部分のみKnowledge候補へ回す。

成果物には候補、根拠、不足情報、除外条件、専門家確認事項、Agent／Skill版、生成日時を含める。AIが工法採用、警報解除、ポンプ操作を決定する工程は含まない。

## 14. 検証・受入れ

| 分類 | 必須の検証 |
|---|---|
| Unit | スキーマ、Skill読み込み、状態遷移、根拠ID、Policy、予算予約 |
| DB統合 | マイグレーション、版参照、Lease、並行取得、監査並行追記 |
| 認可 | 案件越境、無効化ユーザー、失効した権限、候補知識の不正検索 |
| 承認 | 自己承認、承認後改変、期限切れ、取消、順序逆転、外部承認偽装 |
| 耐障害 | 二重配信、Worker停止、APIタイムアウト、キャンセル、成否不明の外部書き込み |
| AI品質 | 引用の実在・支持、不足条件の検出、棄権、単位・年月・版の混同、適用範囲の過大一般化 |
| 攻撃 | 文書内命令、悪意あるSkill、Tool応答経由の命令、パストラバーサル、SSRF、データ流出 |
| E2E | 起動→草案→根拠表示→人間レビュー。未接続は未接続として表示 |

専門Ownerがレビューした評価例を用い、開発用と保持用評価セットを資料・案件単位で分離する。最初は公開資料を基にした匿名化ケースと合成ケースを使い、本番資料を無断投入しない。LLMによる自己採点だけを合否に使わない。

受入条件は、指定試験における未承認実行・自己承認・案件越境・機密漏えいが0件、重大な主張に根拠または明示的な不明表示があること、外部副作用の重複を防止または成否不明として停止できること、実測した使用量・費用・処理時間が表示されること。これらは試験条件であり、あらゆる実運用に対する無事故保証ではない。

KPIはAgent数ではなく、同じ課題の人手作業時間との差、専門家の修正量、受入率、重大な根拠誤り、成果物当たり費用を用いる。削減率を実測前に作らない。

## 15. 段階導入

| 段階 | 内容 | 完了判断 |
|---|---|---|
| P0 | 現状棚卸し、ADR、テストDB安全化、Registry、権限、承認拘束、Worker、監査・使用量 | 統制の否定系テストが通る |
| P1 | 初期3Agent・12Skill、承認済み公開知識、草案と根拠のUI | 1つ以上の実動縦断経路＋3Agentの評価。未実装は明示 |
| P2 | 港湾、地盤、維持管理、安全品質環境、研究等の文書支援 | 各専門Ownerの評価・受入れ、必要なデータ利用承認 |
| P3 | 仕様・権限を確認した専門システムの読み取り連携 | 契約試験・照合・障害時停止が検証済み |

最初の縦断経路は「技術候補検索→適用条件の不足整理→引用付き比較草案→人間レビュー」とする。P1初期は3名の限定評価とし、本番公開、正式承認を要する外部書き込み、Secret設定は別の明示承認を要する。

自己改善は「失敗分類→Skill改訂候補→PR→固定評価→専門レビュー→承認→版付き配布→ロールバック」に限定する。運用中のSkill・権限・評価基準をAI自身が書き換えて自己承認する機能は追加しない。

## 16. 参照資料

### 公式サイト（閲覧日 2026-09-08）

- https://www.mirai-const.co.jp/
- https://www.mirai-const.co.jp/work/
- https://www.mirai-const.co.jp/technology/
- https://www.mirai-const.co.jp/company/
- https://www.mirai-const.co.jp/sustainability/
- https://www.mirai-const.co.jp/technology/port/5061/ — MC-Float Navi
- https://www.mirai-const.co.jp/technology/port/4361/ — MC-Caisson
- https://www.mirai-const.co.jp/technology/port/3783/ — MC-Wake
- https://www.mirai-const.co.jp/technology/ground/633/ — CPG工法
- https://www.mirai-const.co.jp/technology/environment/
- https://www.mirai-const.co.jp/sustainability/quality/
- https://www.mirai-const.co.jp/sustainability/environment/
- https://www.mirai-const.co.jp/sustainability/occupationalsafetyandhealth/

### 形式・開発ツールの公式仕様（閲覧日 2026-09-08）

- https://agentskills.io/specification
- https://agentskills.io/client-implementation/adding-skills-support
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents

### リポジトリ（GitHub接続で読み取り）

確認コミット：`e173ecc6d544b8f762bbaa5bf0bed26da63a293c`

- `README.md`（冒頭〜180行）
- `app/README.md`
- `app/migrations/003_full_backend.sql`
- `app/src/routes/platform.js`
- `app/src/routes/tasks.js`
- `app/src/routes/approvals.js`
- `app/src/routes/knowledge.js`
- `app/src/lib/llm.js`
- `app/src/lib/audit.js`
- `app/test/e2e.test.mjs`（冒頭〜110行）

本設計の機能名、API、配置、追加テーブル、Agentカタログは提案であり、上記コミットへの実装済み宣言ではない。
