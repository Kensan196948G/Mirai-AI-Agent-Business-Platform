# 全社員アイデア創出から本番運用・ナレッジ循環までのAI/DX開発プロセス（Idea to Value）

> みらい AIエージェント事業推進基盤（Mirai AI Agent Business Platform）
>
> 本ドキュメントは `docs/ai-dx-dev-process.html`（確定版）のMarkdown版です。内容の正式版はHTML版とし、本ファイルはHTML版に同期します。

---

## 基本方針（全体コンセプト）

この基盤は単なる「AI開発受付」ではなく、**全社員のアイデアを事業・業務・システムへ変換するAIエージェント型の事業本部基盤**である。

Slack・AppSuite・GitHubの三層構造（**Slack＝自由に話す・AppSuite＝正式案件化して承認する・GitHub＝実装を統制する**）が肝であり、Slackを稟議システム化せず、AppSuiteをチャット化しない。

**知識の扱い：** AIにSlackの全会話を横断的に「覚えさせる」のではなく、**会話 → AI整理 → 人間レビュー → Notionへ確定知識化**する。

- 検討中の作業文書＝Slack Canvas
- 人間レビュー済みの確定知識＝Notion
- 案件・承認状態＝AppSuite
- 開発成果物＝GitHub（正本）

**Idea to Value**（企画 → 審査 → 開発 → 検証 → 本番化 → 効果測定 → 知識循環）を一つの基盤で回す。

---

## 01. 各ツールの役割

| ツール | レイヤ | 役割 |
|---|---|---|
| **Lightblue / AI Agent** | AI Agent Layer | 全社員向けAI窓口。壁打ち、追加質問、要約、分類、企画化支援、Notionナレッジ検索 |
| **Slack / Slack Canvas** | Collaboration | 日常会話・案件Channel・検討・レビュー・通知の作業場。Canvasはアイデア・企画の検討中ドキュメント（共同編集） |
| **Notion** | Knowledge / Context | AIと人間が参照する長期知識基盤。人間レビュー済みの確定知識（アイデア、企画、決定事項、要件、設計判断、教訓）を保存 |
| **AppSuite** | Process / Transaction | 正式案件・承認状態の正本（Process Master）。案件ID、責任者、Phase、Gate、期限、状態、KPI、ROIを管理するAI事業ポートフォリオ台帳 |
| **desknet's NEO Workflow** | Governance | 正式な申請、段階的承認、差戻し、審査履歴を管理。AppSuiteと連携しGate承認の正本 |
| **Claude / Claude Code** | Expert AI | 高度分析、要件定義、設計、レビュー、実装・テスト支援 |
| **GitHub** | Engineering SoR | Repository、Issue、Pull Request、Test、Release、CI/CD。protected branches・必須PRレビュー・Environment別デプロイ承認で統制 |
| **監視基盤** | Observability | 本番の稼働状況、ログ、メトリクス、障害、セキュリティイベント、AI利用量・コストを継続監視（**監視ツールは本基盤とは別途選定**） |

> **AIエージェントの組織（将来拡張）：** AIを1体の万能Botにせず、`AI Orchestrator`配下に専門エージェントを置くことで拡張性を確保する（Idea Agent＝壁打ち / Planning Agent＝企画書 / Business Analysis Agent＝ROI・KPI / ドメインAgent＝業務知識 / Requirement Agent＝要件 / Architecture Agent＝設計 / Security Agent / Coding Agent / QA Agent / Release Agent / Knowledge Agent＝知見蓄積）。ユーザーからは単一のAI窓口に見える構成でも内部でルーティングすれば現行と両立できる。

---

## 02. アイデアから本番化までのファネル

| # | 段階 | 主担当 |
|---|---|---|
| 1 | AI相談 | Lightblue |
| 2 | Idea育成 | Slack Canvas / Notion |
| 3 | 正式案件 | AppSuite |
| 4 | 審査・承認 | Workflow / Gate |
| 5 | 要件・設計 | Claude / Notion |
| 6 | 開発・検証 | GitHub |
| 7 | 本番・運用 | RC / DevSecOps / Knowledge |

各段の進捗は、Gate1〜Gate5の承認を経て確定する（03参照）。

---

## 03. 5 Stage Gate（進捗承認ゲート）

**「Slackで承認したから開発開始」は禁止。**
必ず Slack（検討）→ AppSuite（正式申請・状態更新）→ desknet's NEO Workflow（正式承認）→ GitHub（開発開始）の順で進め、各GateはAppSuiteのGate状態とWorkflowの承認履歴を正本とする。

| Phase | 成果物 | Gate | 承認の主な関与者 |
|---|---|---|---|
| Idea | AI壁打ち結果・企画検討Canvas | ― | 提案者（全社員） |
| Planning | 企画書・As-Is/To-Be・効果・KPI | **Gate 1 企画承認** | 経営企画（主）＋ドメイン＋IT/DX（AXWG等） |
| Definition | 要件定義・仕様・リスク評価 | **Gate 2 開発承認** | ドメイン＋IT/DX（技術仕様はドメイン承認） |
| MVP | MVP・テスト結果・利用者フィードバック | **Gate 3 MVP承認** | ドメイン＋IT/DX（経営企画は最終承認） |
| Staging | 結合試験・UAT・セキュリティ確認 | **Gate 4 本番移行承認** | ドメイン（UAT受入）＋経営企画（移行判定） |
| Production RC | Release Candidate（承認済みタグ） | **Gate 5 Release承認** | 上位Gate Owner（DX統括）＋IT/DX |
| Production | 本番Deploy | ― | IT/DX（CI/CD実行） |
| Operation | DevSecOps・効果・KPI評価 | 継続評価 | 経営企画（継続/改善/停止） |

> **Production環境では開発しない。**
> MVP / DEV → Staging → Production Release Candidate → Release承認 → Production Deploy の順で進め、本番へは承認済みRelease TagのみをDeployする。GitHubのprotected branches・必須PRレビュー・status checks・Environment別デプロイ承認を活用する。

---

## 04. 20フェーズのAI/DX開発プロセス

各フェーズの【】内は対応するStage（Idea / Planning / Gate 1〜5 / Operation）を示す。

### 01. 全社員からアイデア受付 【Idea】［Lightblue］

現場担当者が「点検時に撮影した写真と手書きメモから、日報・点検報告書を自動作成したい」とAIへ相談する。Lightblueは必要に応じてNotionを参照し、過去の類似案件、既存システム、社内AI利用ルール、既知のリスクを検索する。

> この段階では正式案件にしない。社員が「困りごと」を自然言語で相談できることを優先する。

### 02. 課題明確化 【Idea】［Lightblue + Notion］

AIが既存知識を参照しながら追加質問し、現状業務、対象者、頻度、工数、データ保存先、個人情報、位置情報、既存システム代替可否などを深掘りする。

> 決定：AIが毎回ゼロから質問するのではなく、社内知識を踏まえた壁打ちへ移行する。

### 03. アイデア構造化 【Idea】［Lightblue → Slack Canvas / Notion］

**企画名：** 現場写真・点検記録からの日報／点検報告書自動作成

- 目的：報告書作成時間を削減し、記録品質と提出速度を向上
- 課題：写真整理、メモ転記、帳票作成、上長確認に時間がかかる
- 対象者：現場監督、施工管理者、安全管理者、協力会社担当者
- 期待効果：1件60分 → 20分
- MVP：写真アップロード、AI所見案、Excel/PDF出力
- 概算工数：PoC 2〜4週間、MVP 1〜2か月

**Notion Idea DB：** Idea ID、提案者、所属、原課題、壁打ち結果、期待効果、リスク、類似案件、関連ナレッジ、ステータス等を保持する。検討中の作業文書はSlack Canvasで共同編集する。

> 検討中ドラフト＝Slack Canvas、人間レビュー済みの確定版＝Notion Idea DB。まだAppSuiteへは登録しない。

### 04. 企画候補登録 【Planning】［Notion → AppSuite］

AXWG等で価値があると判断したアイデアのみをAppSuiteのDX企画候補台帳へ昇格する。企画概要、対象部署、課題、期待KPI、概算費用、想定効果、リスク、類似事例、AXWGコメントを連携する。

> **Notion = アイデア・知識** ／ **AppSuite = 正式案件**

### 05. 案件ID発番 【Planning】［AppSuite］

例：`DX-2026-0042`

案件IDは、AppSuite、Notion、Slack、Slack Canvas、GitHub、Workflow申請、成果物フォルダ、BIダッシュボードなど、案件に関係する各システム・成果物を横断して紐付ける共通キーとして使用する。

> Slack ChannelやNotionの案件ページを必須工程とはせず、案件規模・関係者・運用方法に応じて必要な協働環境を選択する。案件が増えた場合はAIが案件専用Channel（例：`proj-2026-042-現場点検報告AI`）を自動生成する方式へ移行する。

### 06. 企画検討 【Planning】［Slack + Claude + Notion］

案件に関係する担当者（経営企画・ドメイン・IT/DX）がSlack等で検討を行い、Claudeが会話・会議内容から決定事項、未決事項、次アクションを整理する。

- **決定：** MVPは日常安全点検報告書、AI生成文は人間確認必須、写真は案件フォルダ単位で保存
- **未決：** 人物マスキング、GPS利用範囲、協力会社アクセス権
- **次アクション：** 認証方式確認、代表帳票10件準備、KPI基準値設定

> **警告：Slack全ログをそのままNotionへ保存しない。**
> Raw Conversation → AI要約 → 人間レビュー → Decision Log / Meeting Notes / Open Issues / Action Items としてNotionへ登録する。

### 07. 企画審査（Gate 1）【Gate 1 企画承認】［Notion + Workflow + AppSuite］

Notionで企画書、背景、As-Is / To-Be、費用対効果、情報管理方針、MVP範囲、リスク、Decision Logを整理し、確定版をWorkflow審査へ送る。審査履歴・承認結果・差戻し状態はWorkflow / AppSuiteを正本とする。事業価値の最終承認は経営企画、技術的妥当性はドメインが主導する。

- AI出力を自動提出しない
- 写真アクセス制御を実装（承認条件）
- MVP後に効果測定を実施（承認条件）

### 08. 要件定義 【Definition】［Claude + Slack + Notion］

ClaudeがLightblue相談、Notion Idea、Decision Log、企画審査結果、Slack確定議論、類似案件を参照して要件定義書を作成する。

- **業務要件：** 写真アップロード、属性入力、AI所見ドラフト、編集・承認、PDF/Excel出力、履歴保持
- **非機能要件：** Entra ID等との連携、RBAC、保管分離、監査ログ、AI送信データ最小化

> Notionでは要件定義書をLiving Documentとして管理する。

### 09. 要件承認（Gate 2）【Gate 2 開発承認】［Notion + AppSuite / Workflow］

NotionでVersion、Status、Owner、Approved Dateを管理し、Workflowで業務責任者（ドメイン）、PO、情報システム責任者（IT/DX）、セキュリティ責任者が承認する。技術仕様の承認はドメインが主導する。

- 必須要件：承認済み
- 個人情報・写真データ方針：承認済み
- KPI：承認済み（経営企画）
- MVP予算：承認済み（経営企画）

> Notion = 承認された要件内容 ／ AppSuite = 承認状態・Gate

### 10. 開発案件化 【MVP / DEV】［GitHub + Notion］

- Repository例：`dx-2026-0042-site-report-ai`
- GitHub Project：DX-2026-0042 現場点検報告AI MVP
- Issue：認証・権限、写真API、AI生成API、帳票、PDF/Excel、監査ログ、CI/CD等

Notion Project HomeからRepository、Project、Architecture、ADR、開発ガイドラインへリンクする。

### 11. MVP開発 【MVP / DEV】［Claude Code + GitHub + Notion］

Claude CodeがIssue単位の実装、API雛形、入力検証、テスト草案、PR説明、整合性レビューを支援する。コード・Issue・PRはGitHubを正本とし、Notionにはアーキテクチャ概要、AIモデル選定理由、セキュリティ判断、ADRなど「なぜそうしたか」を残す。

> PRの最終承認は、開発者本人ではなく別のIT/DX担当（コードレビュー）が行う（SOD、06章参照）。

### 12. テスト 【MVP / DEV】［GitHub CI/CD + Notion］

- Lint / Unit Test / Integration Test
- 依存ライブラリ脆弱性スキャン
- Secret Scan / Container Scan
- AI生成文の禁止・不適切表現チェック

GitHubを詳細Test Resultの正本とし、NotionにはTest Strategy、Test Summary、既知制約、重要不具合と判断を集約する。

### 13. MVP評価（Gate 3）【Gate 3 MVP承認】［Slack + AppSuite + Notion］

AppSuiteは数値評価・KPI・評価ステータス、Slackは利用者の生Feedback、NotionはFeedback分析・改善要望・Product Lessonsを管理する。技術受入はドメイン、最終承認は経営企画が担う。

| KPI | 値 |
|---|---|
| 報告書平均作成時間 | 58→24分 |
| AI所見採用率 | 72% |
| 利用者満足度 | 4.1 / 5 |
| MVP試行例 | 10件 |

### 14. Staging 【Staging】［GitHub + CI/CD + Notion］

mainマージ後、CI/CDでStagingへ自動Deploy。本番データは使わず、マスキング済みテスト写真・テスト現場・テストアカウントを使用する。NotionにStaging構成、テストデータ方針、制約、UAT手順を記載する。

### 15. 業務受入試験（UAT）【Gate 4 本番移行承認】［AppSuite + Notion］

AppSuiteでUATシナリオ、結果、不具合、受入判定を管理し、Notionで全体サマリー、利用者知見、操作上の注意、業務ルールへの影響を整理する。UATはドメイン（業務担当）が主導する。

- 重大障害：0件
- 高優先度不具合：解消済み
- 業務責任者（ドメイン）：受入可

### 16. 本番承認（Gate 5）【Gate 5 Release承認】［Workflow + AppSuite + Notion］

Notion Project HomeにUAT結果、Security Review、Monitoring Design、Rollback Plan、Runbook、User Manualを集約し、Workflowで本番Gateを承認する。承認されたバージョンをRelease Candidate（RC）として確定する。

- UAT完了（ドメイン受入）
- 重大不具合なし
- セキュリティ確認完了
- 監視設計完了
- Rollback確認済み
- 上位Gate Owner承認済み

### 17. Production Deploy 【Production】［GitHub CI/CD + AppSuite + Notion］

Gate 5で承認されたRelease Candidate（Release Tag）から本番Deployを実行する。AppSuiteは本番日・Version・Status、GitHubはRelease・Deployment履歴、NotionはProduction Architecture・Runbook・FAQ・Manual・Troubleshootingを管理する。

> **本番環境では開発しない。** 未承認のコミットが本番へ到達する経路をGitHubのEnvironment保護ルールで遮断する。

### 18. DevSecOps 【Operation】［監視基盤 + Slack + GitHub + Notion］

監視基盤により、ログイン、写真Upload、AI API、帳票出力、Error、稼働状況、Security Event、AI利用量・Cost等を継続監視する（**監視ツールは別途選定**）。

障害時：**監視基盤アラート → Slack通知 → GitHub Issue / Incident**として対応を記録・管理する。

> 重大Incident終了後は、原因・影響・対応・再発防止・Lessons LearnedをAIが整理し、人間確認後にNotionへPostmortemとして登録する。

### 19. 効果測定 【Operation】［AppSuite + BI + Notion］

- **AppSuite / BI（What happened）：** 月間件数、平均時間、AI採用率、差戻し率、利用者数、削減工数、Cost、ROI
- **Notion（Why it happened）：** なぜ効果が出たか、想定との差異、定着要因、使われなかった機能、次の改善、他現場展開可能性

> 効果測定の主導は経営企画が担う。

### 20. ナレッジ化・継続判断 【Knowledge】［Notion + Lightblue RAG］

最終Knowledge SourceをNotion中心に整理し、Lightblueが次回相談時に検索・参照できる状態へ戻す。経営企画は実績KPIと投資効果から「継続 / 改善 / 停止」を判定し、AppSuiteへ記録する。

- **Business：** 企画書、As-Is / To-Be、業務ルール、KPI、ROI、Feedback
- **Governance：** 審査指摘、承認条件、Security判断、Risk判断
- **Engineering：** 要件、Architecture、ADR、Test Strategy、Postmortem
- **AI：** 良い生成例、修正例、禁止表現、Prompt/RAG設計、評価
- **Lessons Learned：** 成功要因、失敗要因、不採用設計、性能・セキュリティ上の注意

次の社員が類似相談をすると、Lightblueが過去案件を検索し、企画・要件・リスク・KPI・Lessons Learnedを踏まえ、より高精度な提案へつなげる。

---

## 05. 3つのAuthority（職掌）と上位Gate Owner

3者は単なる「レビュー担当」ではなく、それぞれ異なる**Authority（決定権）**を持つ。誰が単独決定してはならないかを明確にし、SOD（職務分掌）で相互牽制する。

| Authority | 担い手 | 主な責任範囲 | 単独決定してはならないこと |
|---|---|---|---|
| **Business Authority** | 経営企画 | 経営戦略との整合、事業価値、ROI、KPI、投資優先順位、対象部署、業務改革、全社展開・投資継続/停止の判断 | 技術仕様 |
| **Domain Authority** | 建設土木技術（業務部門） | 業務妥当性、技術基準、法令・基準、施工方法、品質、安全、現場実用性、AI回答の技術的妥当性、UAT・技術受入判定 | システム構成・本番Deploy |
| **Engineering Authority** | IT・DX（開発部門） | システム/AIアーキテクチャ、データ設計、API、セキュリティ、IAM、GitHub、CI/CD、テスト、ログ・監視、DevSecOps、デプロイ実行 | 自分が開発したシステムの単独本番承認 |

### 上位Gate Owner（AI/DX統括責任者・第4の役割）

作業は行わず、上記3つのAuthorityを束ねる「AI/DX Governance」の最終責任者。特に以下の案件・事項についてGateの最終承認権を持つ。

- 高額案件 / 全社システム / 社外秘データの利用
- 生成AI利用・AI自動判断の範囲
- Production Release（Gate 5の最終承認）

---

## 06. SOD（職務分掌）と絶対に守るルール

### RACI表

| 行為 | 経営企画（Business） | 建設土木技術（Domain） | IT/DX（Engineering） |
|---|---|---|---|
| アイデア提出 / AI壁打ち | ○ | ○ | ○ |
| 事業価値評価 | **A** | C | C |
| 技術妥当性 | C | **A** | C |
| システム実現性 | C | C | **A** |
| ROI / KPI設定 | **A** | C | C（工数提示） |
| 要件定義 | A | **R** | **R** |
| システム設計 | C | C | **R** |
| 技術仕様承認 | C | **A** | R |
| セキュリティ評価 | C | C | **R** |
| コーディング | ― | C | **R** |
| コードレビュー | ― | C（必要時） | R（別IT担当） |
| MVP評価 | A | **R** | R |
| UAT | C | **R** | C（支援） |
| Staging Deploy | ― | ― | **R** |
| 本番移行判定（Gate 4） | A | A | R |
| Production Deploy | ― | ― | **R** |
| 効果測定 | **R** | R | C |
| 継続 / 停止判断 | **A** | C | C |

R = Responsible（実行）／ A = Accountable（最終責任・承認）／ C = Consulted（助言・参画）／ ○ = 実施可（参加）／ ― = 関与しない

### 絶対に守るSOD（システム上も禁止することが望ましい）

- `企画者 ≠ 企画最終承認者`
- `開発者 ≠ Pull Request最終承認者`
- `開発者 ≠ Productionリリース最終承認者`
- `AI ≠ 承認者`（AIは承認できず、提案・支援のみ）
- `技術評価者 ≠ 経営投資判断者`
- `Slack上の「OK」≠ 正式承認`（正式承認はWorkflow / AppSuiteの記録のみ）

> AIエージェントがどれだけ高度になっても、承認は必ず人間が担い、**企画・承認・開発・運用の権限を分離**することでガバナンスを維持する。

---

## 07. AppSuite案件台帳（AI事業ポートフォリオ）

AppSuiteは案件の状態・Gate・責任者・KPIを一元管理する**AI事業ポートフォリオ台帳**。案件IDを共通キーとして各システム（Notion / Slack / GitHub / Workflow / BI）と紐付ける。

| 分類 | 項目 | 内容 |
|---|---|---|
| 基本 | Project ID / プロジェクト名 | 案件ID（例：DX-2026-0042）と案件名 |
| 基本 | 提案者 / 所属 / 提案日 | アイデアを出した社員と所属 |
| 基本 | 現状課題 / 想定効果 | 課題・To-Beと期待効果 |
| 基本 | KPI / ROI | 効果測定指標と投資対効果 |
| 基本 | AI利用有無 / AIリスク | AI機能の有無とリスク評価 |
| 体制 | 技術責任者（Domain） | 建設土木技術の受入責任者 |
| 体制 | 開発責任者（IT/DX） | 開発・実装の実行責任者 |
| 体制 | Business Owner（経営企画） | 事業価値の最終責任者 |
| 体制 | Gate Owner（上位統括） | 高額案件等のGate最終承認者 |
| 状態 | Phase / Gate 1〜5 | Idea / Planning / Definition / MVP / Staging / Production と各Gate状態 |
| 状態 | Repository / Slack Channel / Canvas | GitHubリポジトリ、Slackチャンネル、検討Canvasへのリンク |
| 状態 | Version / Deployment Date | Releaseバージョンと本番デプロイ日 |
| 効果 | 実績KPI / 判定 | 測定結果と「継続 / 改善 / 停止」の判定（経営企画） |

---

## 08. Knowledge Feedback Loop

```text
全社員
  ↓
Lightblue（AI壁打ち）
  ↓
Slack Canvas → Notion（Idea / 確定Knowledge）
  ↓
AXWG → 3 Authority
  ↓
AppSuite（正式案件・Portfolio台帳）
  ↓
Workflow（Gate審査・承認）
  ↓
Notion（要件・意思決定）
  ↓
Claude / Claude Code
  ↓
GitHub（開発・テスト・Release）
  ↓
MVP / Staging（UAT）
  ↓
Gate 5 → Production RC → Production Deploy
  ↓
監視基盤（DevSecOps）→ AppSuite / BI（KPI・ROI）
  ↓
Notion（Lessons Learned）
  ↓
Lightblue（次回相談の文脈）
  ↓
次のアイデア
```

---

## 09. 各情報の「正本」

| 情報 | System of Record / 正本 | 役割 |
|---|---|---|
| AIとの相談 | **Lightblue** | 相談履歴・壁打ち |
| 検討中ドラフト | **Slack Canvas** | 共同編集・検討文書 |
| アイデア・確定知識 | **Notion** | Idea DB・Knowledge Hub |
| 正式案件 / Phase / Gate | **AppSuite** | 案件台帳・プロセス管理 |
| 承認・決裁（Gate正本） | **desknet's NEO Workflow** | 申請・承認・差戻し履歴 |
| 日常議論 | Slack | コミュニケーション |
| 決定事項・判断根拠 | **Notion** | Decision Log |
| 企画書・要件定義 | **Notion** | Knowledge / Context |
| ソースコード | **GitHub** | Engineering SoR |
| Issue / PR / Test / Release | **GitHub** | 開発・変更履歴 |
| Deployment | **GitHub CI/CD** | Release履歴 |
| 稼働監視・ログ・障害 | **監視基盤** | Observability（ツールは別途選定） |
| KPI / ROI数値・継続判定 | **AppSuite / BI** | 効果測定・ポートフォリオ評価 |
| Lessons Learned | **Notion** | 再利用可能な知識 |
| AIが検索する社内知識 | **Notion → Lightblue** | 次回のAI文脈 |

> **承認の流れは必ず：** Slack（検討）→ AppSuite（正式申請・状態更新）→ desknet's NEO Workflow（正式承認）→ GitHub（開発開始）。
> Slack上の発言・リアクションは正式承認ではない。

---

## 10. 設計原則

| ツール | 役割 |
|---|---|
| Slack / Canvas | **話す・練る場所** — 自由な相談・議論・レビュー・通知・検討ドキュメント |
| Lightblue | **考えるAI** — 壁打ち・整理・検索・企画化 |
| Notion | **覚える場所** — 人間レビュー済みの確定知識を保存 |
| AppSuite | **案件を管理する場所** — Phase・Gate・責任者・KPI・Portfolio |
| Workflow | **会社として承認する場所** — 申請・承認・差戻し・決裁（Gate正本） |
| Claude | **専門的に考えるAI** — 要件・設計・レビュー・開発支援 |
| GitHub | **作る場所** — Issue・Code・PR・Test・Release・統制 |
| 監視基盤 | **見守る場所** — 稼働・障害・Security・AI利用量（ツール別途選定） |

> **Conversation → AI整理 → Human Review → Notion Knowledge**
>
> Slackは会話、AppSuiteは統制、GitHubは実装、AI Agentはそれらを横断する「デジタル事業本部員」。

Slack上の古い発言、誤解、途中案、雑談をAIが同等に扱うことを避け、**会社として信頼できる知識**だけをNotionへ蓄積する。承認はWorkflow / AppSuiteの記録のみを正本とし、3つのAuthorityとSODで相互牽制する。そのKnowledgeをLightblue・Claude・将来のAI Agentが再利用することで、開発プロセス自体が継続的に賢くなる循環型基盤を形成する。

**「AIを使う会社」ではなく、「社員の発想をAIが組織的に事業・システムへ変換する会社」を目指す。**
