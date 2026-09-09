# Mirai AI Agent Business Platform
# Agent / Skills / AI Runtime 全機能確認チェックリスト
## Claude Code 全面検証・是正用

対象Repository: `Kensan196948G/Mirai-AI-Agent-Business-Platform`  
基準構造:

```text
利用者 / User
   ↓
司令塔Agent / CTO Orchestrator
   ↓
┌─────────────────────────────────────┐
│ 組織責務Agent / Organization Agents │
│ 01～09                              │
└─────────────────────────────────────┘
   ↓ 必要に応じて連携
┌─────────────────────────────────────┐
│ 土木専門Agent / Civil Expert Agents │
│ 港湾・地盤・構造・施工・CAD等       │
└─────────────────────────────────────┘
   ↓
Skills / スキル
   ↓
Knowledge / ナレッジ ＋ Tools / ツール
   ↓
横断レビュー / Cross Review
   ↓
人間の確認・承認 / Human Review & Approval
```

---

## 0. Claude Codeへの実行指示

このチェックリストは「資料に書いてあるか」ではなく、**実コード・DB・API・Worker・UI・テストで本当に動作するか**を確認するためのものとする。

各項目について必ず以下のいずれかで判定すること。

- [ ] PASS — 実装・自動テスト・実行確認まで完了
- [ ] PARTIAL — 一部実装、制約あり
- [ ] FAIL — 不具合・仕様不一致
- [ ] NOT IMPLEMENTED — 未実装
- [ ] NOT APPLICABLE — 現フェーズ対象外

各FAIL/PARTIAL/NOT IMPLEMENTEDについて、必ず以下を残す。

1. 原因
2. 対象ファイル
3. 修正方針
4. 修正内容
5. 追加テスト
6. テスト結果
7. 残存リスク

原則として、重大な問題は発見だけで終わらせず修正する。  
ただし、外部本番サービスへの接続、秘密情報投入、本番デプロイ、不可逆操作は人間承認なしで実行しない。

---

# A. 全体アーキテクチャ整合性

- [ ] A-001 User → Orchestrator → Agent → Skill → Knowledge/Tool → Cross Review → Human Approval の一連の処理経路がコード上で追跡可能
- [ ] A-002 各レイヤが単なるUI表示ではなく、バックエンド実装と結び付いている
- [ ] A-003 Agent定義とSkill定義が分離されている
- [ ] A-004 Organization AgentとCivil Expert Agentを論理的に区別できる
- [ ] A-005 Agentが直接すべての処理を持たずSkillを呼び出す構造になっている
- [ ] A-006 Skillが複数Agentから再利用可能
- [ ] A-007 KnowledgeとToolがSkillから明示的に利用される
- [ ] A-008 Cross Reviewを独立した処理として実装可能
- [ ] A-009 Human Approvalを回避して高リスク処理を完了できない
- [ ] A-010 全処理にtrace/run/task/project等の関連IDが付与される
- [ ] A-011 途中失敗時にも監査可能
- [ ] A-012 同一リクエストの二重実行を制御できる
- [ ] A-013 再実行時に不整合を起こさない
- [ ] A-014 Agent Runtimeと通常の業務Workflowが矛盾しない
- [ ] A-015 設計資料・README・実コードの機能状態表示が一致する

# B. CTO Orchestrator / 司令塔Agent

- [ ] B-001 Orchestrator相当の責務がコード上に存在
- [ ] B-002 ユーザー要求を受け取る
- [ ] B-003 意図分類ができる
- [ ] B-004 対象Organization Agentを選択できる
- [ ] B-005 必要なCivil Expert Agentを追加選択できる
- [ ] B-006 Skill候補を選択できる
- [ ] B-007 複数Agentへの分解ができる
- [ ] B-008 実行順序を決定できる
- [ ] B-009 並列実行可能な処理を識別できる
- [ ] B-010 依存関係を持つ処理を順序制御できる
- [ ] B-011 Agent選択理由を記録する
- [ ] B-012 Skill選択理由を記録する
- [ ] B-013 リスクレベルを考慮して経路選択する
- [ ] B-014 Policy DENY時に別経路へ勝手に迂回しない
- [ ] B-015 Approval Required時に停止できる
- [ ] B-016 失敗したAgentの結果を成功扱いしない
- [ ] B-017 部分成功を表現できる
- [ ] B-018 タイムアウトを制御する
- [ ] B-019 最大Step数/最大再帰深度を制限する
- [ ] B-020 Agent同士の無限呼出しを防止する
- [ ] B-021 Run予算上限を守る
- [ ] B-022 Token/Cost上限を守る
- [ ] B-023 全Agent結果を最終回答に統合できる
- [ ] B-024 根拠が不足している場合「不足」と返す
- [ ] B-025 人間最終判断対象を自動確定しない

# C. Organization Agents 01〜09

以下の9責務が「設定上の名称だけ」でなく、Agent Contract / Registry / Runtimeから識別可能か確認する。

## 01 経営・統治・委員会
- [ ] C01-01 Agent定義あり
- [ ] C01-02 経営戦略支援
- [ ] C01-03 Governance
- [ ] C01-04 Committee Support
- [ ] C01-05 Risk & Compliance
- [ ] C01-06 KPI Review Skill利用
- [ ] C01-07 Decision Log Skill利用
- [ ] C01-08 SoD Check利用
- [ ] C01-09 経営判断をAI単独確定しない

## 02 営業・案件形成
- [ ] C02-01 Agent定義あり
- [ ] C02-02 Opportunity Qualification
- [ ] C02-03 Tender Analysis
- [ ] C02-04 Proposal Drafting
- [ ] C02-05 Similar Project Search
- [ ] C02-06 Civil Expert Agentへの委譲
- [ ] C02-07 Win/Loss Analysis
- [ ] C02-08 技術判断を営業Agent内で勝手に完結しない

## 03 施工・調達・作業所
- [ ] C03-01 Agent定義あり
- [ ] C03-02 Construction Planning
- [ ] C03-03 Schedule Planning
- [ ] C03-04 Constructability Review
- [ ] C03-05 Temporary Works
- [ ] C03-06 Equipment Planning
- [ ] C03-07 Quantity Takeoff
- [ ] C03-08 Progress Analysis
- [ ] C03-09 現場最終判断を人間に残す

## 04 技術・研究開発
- [ ] C04-01 Agent定義あり
- [ ] C04-02 Literature Review
- [ ] C04-03 Research Planning
- [ ] C04-04 PoC Planning
- [ ] C04-05 Technology Comparison
- [ ] C04-06 Standard Search
- [ ] C04-07 Patent Search
- [ ] C04-08 Evidence Verification
- [ ] C04-09 根拠・引用・出典の追跡可能性

## 05 安全・品質・環境
- [ ] C05-01 Agent定義あり
- [ ] C05-02 Hazard Identification
- [ ] C05-03 Risk Assessment
- [ ] C05-04 Safety Review
- [ ] C05-05 Quality Plan Review
- [ ] C05-06 NCR Analysis
- [ ] C05-07 Environmental Review
- [ ] C05-08 Safety Critical判断を自動承認しない

## 06 管理本部・経営企画
- [ ] C06-01 Agent定義あり
- [ ] C06-02 Business Planning
- [ ] C06-03 Budget & Cost Analysis
- [ ] C06-04 ROI Analysis
- [ ] C06-05 Management Reporting
- [ ] C06-06 DX Portfolio Review
- [ ] C06-07 AI Risk Assessment
- [ ] C06-08 結果説明可能性

## 07 支店・営業支店・営業所
- [ ] C07-01 共通Branch Agent方式
- [ ] C07-02 地域Context注入
- [ ] C07-03 Project Context注入
- [ ] C07-04 Customer Context注入
- [ ] C07-05 Regional Project Overview
- [ ] C07-06 Branch KPI
- [ ] C07-07 Past Project Retrieval
- [ ] C07-08 支店ごとのデータ境界

## 08 船舶事業
- [ ] C08-01 Agent定義あり
- [ ] C08-02 Vessel Assignment
- [ ] C08-03 Fleet Scheduling
- [ ] C08-04 Maintenance Planning
- [ ] C08-05 Marine Logistics
- [ ] C08-06 Dredging Vessel Planning
- [ ] C08-07 Weather/Sea Condition Review
- [ ] C08-08 Marine Safety Review
- [ ] C08-09 港湾Agent/施工Agent/安全Agent連携

## 09 社外向けDX
- [ ] C09-01 Agent定義あり
- [ ] C09-02 Requirement Discovery
- [ ] C09-03 DX Assessment
- [ ] C09-04 Solution Architecture
- [ ] C09-05 Customer Support
- [ ] C09-06 Usage Analysis
- [ ] C09-07 Security Assessment
- [ ] C09-08 顧客単位Tenant境界
- [ ] C09-09 社内AgentOSデータとの不用意な共有防止

# D. Civil Expert Agents / 土木専門Agent

- [ ] D-001 Port / Marine Agent
- [ ] D-002 Geotechnical Agent
- [ ] D-003 Structural Agent
- [ ] D-004 Construction Planning Agent
- [ ] D-005 BIM/CIM・CAD・GIS Agent
- [ ] D-006 Environmental Engineering Agent
- [ ] D-007 Maintenance Engineering Agent
- [ ] D-008 Quantity & Cost Agent
- [ ] D-009 Civil Engineering Review Agent
- [ ] D-010 各Agentの入力契約が定義済み
- [ ] D-011 各Agentの出力契約が定義済み
- [ ] D-012 各Agentの許可Skill一覧が定義済み
- [ ] D-013 各Agentの禁止Tool/Actionが定義済み
- [ ] D-014 技術リスク分類を持つ
- [ ] D-015 T3以上で専門技術者Reviewへ遷移
- [ ] D-016 T5/T6はAI単独完了不可
- [ ] D-017 Civil Agent同士の結果衝突を検出
- [ ] D-018 数値・単位・座標系等の整合確認
- [ ] D-019 根拠基準の版/発行元を保持
- [ ] D-020 不明条件を勝手に補完せず未確定として扱う

# E. Agent Registry / Agent Contract

- [ ] E-001 Agent Registryが実装されている
- [ ] E-002 Agent IDが一意
- [ ] E-003 Agent Versionを管理
- [ ] E-004 Agent Description
- [ ] E-005 Domain
- [ ] E-006 Responsibility
- [ ] E-007 Allowed Skills
- [ ] E-008 Allowed Tools
- [ ] E-009 Risk Class
- [ ] E-010 Required Review
- [ ] E-011 Input Schema
- [ ] E-012 Output Schema
- [ ] E-013 Timeout
- [ ] E-014 Retry Policy
- [ ] E-015 Cost Limit
- [ ] E-016 Model Policy
- [ ] E-017 Knowledge Scope
- [ ] E-018 Tenant/Data Scope
- [ ] E-019 Disabled Agentを実行できない
- [ ] E-020 Registry同期処理の冪等性
- [ ] E-021 壊れたYAML/JSONを拒否
- [ ] E-022 未登録Skill参照を拒否
- [ ] E-023 未登録Tool参照を拒否
- [ ] E-024 Contract変更時の互換性確認

# F. Skills / Skill Registry

- [ ] F-001 Skill Loaderが全Skillを検出
- [ ] F-002 `SKILL.md`必須項目検証
- [ ] F-003 `execution.yaml`必須項目検証
- [ ] F-004 Skill ID一意性
- [ ] F-005 Skill Version管理
- [ ] F-006 Input Schema検証
- [ ] F-007 Output Schema検証
- [ ] F-008 SkillをAgentから独立してテスト可能
- [ ] F-009 複数Agentから同一Skillを再利用可能
- [ ] F-010 Skill内で無制限Tool Call不可
- [ ] F-011 SkillごとのPolicy適用
- [ ] F-012 SkillごとのRisk分類
- [ ] F-013 SkillごとのHuman Review条件
- [ ] F-014 SkillごとのEvaluation Cases
- [ ] F-015 正常系Eval
- [ ] F-016 異常系Eval
- [ ] F-017 境界値Eval
- [ ] F-018 Prompt Injection Eval
- [ ] F-019 Missing Data Eval
- [ ] F-020 Conflicting Evidence Eval
- [ ] F-021 Hallucination耐性Eval
- [ ] F-022 Version更新時Regression Eval
- [ ] F-023 Skill評価結果の永続化
- [ ] F-024 Quality Gate未達SkillのProduction利用禁止
- [ ] F-025 Skill失敗理由をRunへ記録
- [ ] F-026 Skill実行時間記録
- [ ] F-027 Skill利用Cost記録
- [ ] F-028 Skill成果物Lineage記録
- [ ] F-029 SkillごとのOwner明示
- [ ] F-030 廃止Skill参照を検出

# G. Knowledge / ナレッジ

- [ ] G-001 Knowledge Sourceの登録
- [ ] G-002 Source種別管理
- [ ] G-003 Source Owner管理
- [ ] G-004 発行日/版管理
- [ ] G-005 失効日管理
- [ ] G-006 信頼度/品質属性
- [ ] G-007 Data Classification
- [ ] G-008 Access Scope
- [ ] G-009 Source Ingestion実装
- [ ] G-010 重複検出
- [ ] G-011 更新検出
- [ ] G-012 削除/失効時の参照制御
- [ ] G-013 Agent回答からSourceへLineage追跡
- [ ] G-014 Knowledgeなしで断定しない
- [ ] G-015 外部Web情報と社内正本を区別
- [ ] G-016 古い基準と新しい基準を混同しない
- [ ] G-017 ナレッジ候補→承認→昇格Flow
- [ ] G-018 Raw Slackログ等を無審査で正本化しない
- [ ] G-019 Knowledge Curatorの権限制御
- [ ] G-020 Knowledge品質評価を自動テスト

# H. Tools / Tool Gateway

- [ ] H-001 Tool Gateway経由でのみToolを実行
- [ ] H-002 Tool Allowlist
- [ ] H-003 Tool Denylist
- [ ] H-004 AgentごとのTool Permission
- [ ] H-005 SkillごとのTool Permission
- [ ] H-006 Read/Write/Delete権限区別
- [ ] H-007 外部通信制御
- [ ] H-008 SSRF対策
- [ ] H-009 Path Traversal対策
- [ ] H-010 Command Injection対策
- [ ] H-011 Shell実行制限
- [ ] H-012 Secretの引数/ログ露出防止
- [ ] H-013 PII/機密情報の外部送信制御
- [ ] H-014 Timeout
- [ ] H-015 Retry
- [ ] H-016 Rate Limit
- [ ] H-017 Circuit Breaker相当
- [ ] H-018 Tool実行前Policy判定
- [ ] H-019 Tool実行後Audit記録
- [ ] H-020 Tool結果のSchema検証
- [ ] H-021 Tool失敗をLLM成功扱いしない
- [ ] H-022 Destructive ActionにApproval Required
- [ ] H-023 Production ActionにApproval Required
- [ ] H-024 External Publish/SendにApproval Required
- [ ] H-025 File更新の差分/対象記録

# I. Policy Engine / ガバナンス

- [ ] I-001 Policy EngineがRuntimeに強制適用
- [ ] I-002 UIだけでなくサーバ側強制
- [ ] I-003 PERMIT
- [ ] I-004 APPROVAL_REQUIRED
- [ ] I-005 DENY
- [ ] I-006 Risk level別Policy
- [ ] I-007 Role別Policy
- [ ] I-008 Environment別Policy
- [ ] I-009 Data classification別Policy
- [ ] I-010 Tool別Policy
- [ ] I-011 Agent別Policy
- [ ] I-012 Skill別Policy
- [ ] I-013 Tenant別Policy
- [ ] I-014 SoD
- [ ] I-015 DeveloperとApproverの分離
- [ ] I-016 作成者の自己承認制御
- [ ] I-017 ReviewerとApproverの順序
- [ ] I-018 Policy Decision理由を保存
- [ ] I-019 DENYをLLMが上書き不能
- [ ] I-020 Prompt InjectionでPolicy変更不能
- [ ] I-021 Policy config変更を監査
- [ ] I-022 Production Policyをテストで検証
- [ ] I-023 Default Deny原則が必要箇所で機能
- [ ] I-024 未知Actionを安易にPermitしない

# J. Human Review & Approval

- [ ] J-001 Approval Request生成
- [ ] J-002 Approval Step生成
- [ ] J-003 Reviewer
- [ ] J-004 Approver
- [ ] J-005 Knowledge Curator
- [ ] J-006 判断理由必須
- [ ] J-007 Evidence添付
- [ ] J-008 Evidence不足時承認不可
- [ ] J-009 Approval期限
- [ ] J-010 差戻し
- [ ] J-011 却下
- [ ] J-012 承認
- [ ] J-013 承認後のみBlocked Run再開
- [ ] J-014 却下後に勝手に再開しない
- [ ] J-015 Approval IDとRun ID紐付け
- [ ] J-016 高リスクActionの事前承認
- [ ] J-017 Approval内容と実際のAction一致確認
- [ ] J-018 承認後Action改変時は再承認
- [ ] J-019 ApprovalのAudit
- [ ] J-020 Human Final Decisionを明示

# K. Cross Review / 横断レビュー

- [ ] K-001 Cross Review Agent/機能を実装
- [ ] K-002 一次Agentとは独立したReviewerを利用
- [ ] K-003 同じ回答をそのまま追認しない
- [ ] K-004 複数Agent出力の矛盾検出
- [ ] K-005 数値矛盾検出
- [ ] K-006 単位矛盾検出
- [ ] K-007 前提条件矛盾検出
- [ ] K-008 基準/出典矛盾検出
- [ ] K-009 リスク評価矛盾検出
- [ ] K-010 未確認事項抽出
- [ ] K-011 Minority/異論を消さない
- [ ] K-012 Cross Review結果にconfidence表示
- [ ] K-013 PASS/CONDITIONAL/FAIL等の判定
- [ ] K-014 FAIL時Human Reviewへ強制
- [ ] K-015 Safety/Structural Criticalは必ずHuman Review
- [ ] K-016 Cross Review自身もAudit対象
- [ ] K-017 Reviewer Model多様性ポリシー
- [ ] K-018 同一Provider障害時の扱い

# L. AI Model / Provider Adapter / Model Router

- [ ] L-001 Provider Adapter実装
- [ ] L-002 Providerを交換可能
- [ ] L-003 Model Catalog
- [ ] L-004 Model Router
- [ ] L-005 実行時にRouter設定が反映される
- [ ] L-006 AgentごとのModel Policy
- [ ] L-007 SkillごとのModel Policy
- [ ] L-008 Risk別Model Policy
- [ ] L-009 Provider timeout
- [ ] L-010 Rate limit handling
- [ ] L-011 429 handling
- [ ] L-012 5xx handling
- [ ] L-013 Malformed response handling
- [ ] L-014 JSON schema enforcement
- [ ] L-015 Token count
- [ ] L-016 Cost calculation
- [ ] L-017 Monthly cap
- [ ] L-018 Run cap
- [ ] L-019 Provider unavailable時の安全なfallback
- [ ] L-020 高リスク処理をルールベースfallbackで誤完了しない
- [ ] L-021 Temperature等の設定管理
- [ ] L-022 System Prompt version管理
- [ ] L-023 Model response raw logの機密制御
- [ ] L-024 作成ModelとReview Modelの独立性

# M. Prompt / Prompt Guard

- [ ] M-001 System promptとUser promptを分離
- [ ] M-002 外部資料を命令として扱わない
- [ ] M-003 Prompt Injection検出
- [ ] M-004 Indirect Prompt Injection検出
- [ ] M-005 Secret extraction要求拒否
- [ ] M-006 Policy bypass要求拒否
- [ ] M-007 Role escalation要求拒否
- [ ] M-008 Tool abuse要求拒否
- [ ] M-009 Data exfiltration要求拒否
- [ ] M-010 Prompt Guard結果をAudit
- [ ] M-011 Prompt Guard誤検知テスト
- [ ] M-012 日本語Prompt Injectionテスト
- [ ] M-013 英語Prompt Injectionテスト
- [ ] M-014 HTML/Markdown/JSON内Injectionテスト
- [ ] M-015 Tool結果内Injectionテスト

# N. Runtime / Worker / Queue

- [ ] N-001 Run Create
- [ ] N-002 Job Store
- [ ] N-003 Worker
- [ ] N-004 Queue取得
- [ ] N-005 Lock
- [ ] N-006 二重Worker競合防止
- [ ] N-007 Heartbeat
- [ ] N-008 Stale Run回収
- [ ] N-009 Retry
- [ ] N-010 Retry上限
- [ ] N-011 Backoff
- [ ] N-012 Cancel
- [ ] N-013 Pause
- [ ] N-014 Resume
- [ ] N-015 Approval Block
- [ ] N-016 Timeout
- [ ] N-017 Budget reservation
- [ ] N-018 Budget settlement
- [ ] N-019 Partial failure
- [ ] N-020 Idempotency Key
- [ ] N-021 Event sequence
- [ ] N-022 Run status遷移
- [ ] N-023 不正status遷移拒否
- [ ] N-024 Worker crash recovery
- [ ] N-025 DB restart recovery
- [ ] N-026 Provider outage recovery
- [ ] N-027 Tool outage recovery
- [ ] N-028 graceful shutdown
- [ ] N-029 health check
- [ ] N-030 concurrency limit

# O. Artifact / Evidence / Lineage

- [ ] O-001 成果物ID
- [ ] O-002 元Run ID
- [ ] O-003 元Agent ID
- [ ] O-004 元Skill ID
- [ ] O-005 Input source
- [ ] O-006 Knowledge source
- [ ] O-007 Tool call
- [ ] O-008 Model/provider
- [ ] O-009 Prompt version
- [ ] O-010 作成日時
- [ ] O-011 Artifact hash
- [ ] O-012 Evidence validator
- [ ] O-013 改変検知
- [ ] O-014 最新版/旧版区別
- [ ] O-015 Cross Review結果との関連
- [ ] O-016 Approvalとの関連
- [ ] O-017 最終成果物から根拠へ逆引き可能

# P. Audit / Observability

- [ ] P-001 Append-only思想
- [ ] P-002 Hash chain
- [ ] P-003 Chain verify
- [ ] P-004 Audit anchor
- [ ] P-005 Login
- [ ] P-006 Logout
- [ ] P-007 Agent run
- [ ] P-008 Skill run
- [ ] P-009 Tool call
- [ ] P-010 Policy decision
- [ ] P-011 Approval
- [ ] P-012 Knowledge promotion
- [ ] P-013 User/Role変更
- [ ] P-014 Registry変更
- [ ] P-015 Model router変更
- [ ] P-016 Integration変更
- [ ] P-017 Error
- [ ] P-018 Security rejection
- [ ] P-019 Trace ID
- [ ] P-020 Request ID
- [ ] P-021 Run ID
- [ ] P-022 Project ID
- [ ] P-023 Usage
- [ ] P-024 Cost
- [ ] P-025 Latency
- [ ] P-026 Token
- [ ] P-027 Failure rate
- [ ] P-028 Queue depth
- [ ] P-029 Approval pending
- [ ] P-030 Dashboard集計整合性

# Q. Authentication / Authorization / SoD

- [ ] Q-001 Password hash
- [ ] Q-002 Session署名
- [ ] Q-003 Session失効
- [ ] Q-004 Disabled user拒否
- [ ] Q-005 RBACサーバ側強制
- [ ] Q-006 Viewer
- [ ] Q-007 Developer
- [ ] Q-008 Reviewer
- [ ] Q-009 Approver
- [ ] Q-010 Knowledge Curator
- [ ] Q-011 Administrator
- [ ] Q-012 UI非表示だけに依存しない
- [ ] Q-013 IDOR対策
- [ ] Q-014 Horizontal privilege escalation対策
- [ ] Q-015 Vertical privilege escalation対策
- [ ] Q-016 自己承認制御
- [ ] Q-017 管理者操作Audit
- [ ] Q-018 CSRF対策
- [ ] Q-019 Cookie属性
- [ ] Q-020 Session fixation対策
- [ ] Q-021 brute force/rate limit
- [ ] Q-022 password reset安全性

# R. Database / Migration / Data Integrity

- [ ] R-001 全migrationを空DBに適用可能
- [ ] R-002 冪等性
- [ ] R-003 production schemaとの差分なし
- [ ] R-004 FK
- [ ] R-005 UNIQUE
- [ ] R-006 CHECK
- [ ] R-007 NOT NULL
- [ ] R-008 status enum整合
- [ ] R-009 transaction
- [ ] R-010 approval更新原子性
- [ ] R-011 budget更新原子性
- [ ] R-012 run lock原子性
- [ ] R-013 concurrent update
- [ ] R-014 rollback
- [ ] R-015 seed冪等性
- [ ] R-016 demo dataと本番データ混在防止
- [ ] R-017 test DB安全策
- [ ] R-018 backup/restore手順
- [ ] R-019 retention
- [ ] R-020 sensitive data masking

# S. API

- [ ] S-001 全APIに認証
- [ ] S-002 必要APIにRole guard
- [ ] S-003 request schema validation
- [ ] S-004 response schema consistency
- [ ] S-005 400
- [ ] S-006 401
- [ ] S-007 403
- [ ] S-008 404
- [ ] S-009 409
- [ ] S-010 422
- [ ] S-011 429
- [ ] S-012 500
- [ ] S-013 stack trace非露出
- [ ] S-014 secret非露出
- [ ] S-015 pagination
- [ ] S-016 input size limit
- [ ] S-017 content type
- [ ] S-018 API audit
- [ ] S-019 state transition validation
- [ ] S-020 destructive API approval enforcement

# T. WebUI

- [ ] T-001 UI表示と実API状態一致
- [ ] T-002 mockのみで成功表示しない
- [ ] T-003 Agent一覧がRegistryから取得
- [ ] T-004 Skill一覧がRegistryから取得
- [ ] T-005 Agent Run実状態表示
- [ ] T-006 Policy Decision表示
- [ ] T-007 Approval Pending表示
- [ ] T-008 Cross Review表示
- [ ] T-009 Evidence表示
- [ ] T-010 Knowledge source表示
- [ ] T-011 Cost表示
- [ ] T-012 Latency表示
- [ ] T-013 Error理由表示
- [ ] T-014 Retry不可理由表示
- [ ] T-015 Disabled Agent表示
- [ ] T-016 Roleに応じた操作制御
- [ ] T-017 サーバ403時UIも失敗表示
- [ ] T-018 ブラウザ再読込後もDB状態保持
- [ ] T-019 XSS対策
- [ ] T-020 HTML/Markdownの安全な表示

# U. External Integrations

現在「状態管理のみ」の連携と「実接続」を明確に区別する。

- [ ] U-001 GitHub
- [ ] U-002 Slack
- [ ] U-003 Notion
- [ ] U-004 Gmail
- [ ] U-005 各Integrationがmock/status-only/realを明示
- [ ] U-006 status-onlyを実連携済みと表示しない
- [ ] U-007 OAuth/token保管方針
- [ ] U-008 secret logging禁止
- [ ] U-009 outbound allowlist
- [ ] U-010 retry
- [ ] U-011 rate limit
- [ ] U-012 webhook検証
- [ ] U-013 replay attack対策
- [ ] U-014 tenant境界
- [ ] U-015 External writeにapproval
- [ ] U-016 External send/publishにapproval

# V. Security

- [ ] V-001 Dependency vulnerability scan
- [ ] V-002 Secret scan
- [ ] V-003 Gitleaks
- [ ] V-004 npm audit
- [ ] V-005 SQL injection
- [ ] V-006 XSS
- [ ] V-007 CSRF
- [ ] V-008 SSRF
- [ ] V-009 Path Traversal
- [ ] V-010 Command Injection
- [ ] V-011 Prototype Pollution
- [ ] V-012 ReDoS
- [ ] V-013 Unsafe YAML
- [ ] V-014 Unsafe JSON parse assumptions
- [ ] V-015 Prompt Injection
- [ ] V-016 Indirect Prompt Injection
- [ ] V-017 Data Exfiltration
- [ ] V-018 Secret Exfiltration
- [ ] V-019 Excessive Agency
- [ ] V-020 Tool misuse
- [ ] V-021 Privilege Escalation
- [ ] V-022 Insecure Direct Object Reference
- [ ] V-023 Audit tamper
- [ ] V-024 Race condition
- [ ] V-025 DoS / resource exhaustion
- [ ] V-026 Token/cost exhaustion
- [ ] V-027 Infinite agent loop
- [ ] V-028 Supply-chain risk
- [ ] V-029 CI security
- [ ] V-030 production secret protection

# W. Test Suite

既存テストをすべて実行し、失敗をゼロにする。

- [ ] W-001 `npm ci`
- [ ] W-002 `npm run test:unit`
- [ ] W-003 `npm run test:e2e`
- [ ] W-004 auth tests
- [ ] W-005 workflow tests
- [ ] W-006 audit tests
- [ ] W-007 llm tests
- [ ] W-008 skill-loader tests
- [ ] W-009 policy-engine tests
- [ ] W-010 agent-contract-chain tests
- [ ] W-011 skill-handlers tests
- [ ] W-012 source-ingest tests
- [ ] W-013 artifact-lineage tests
- [ ] W-014 evaluation-runner tests
- [ ] W-015 prompt-guard tests
- [ ] W-016 provider-adapter tests
- [ ] W-017 model-catalog tests
- [ ] W-018 connectors tests
- [ ] W-019 security-guards tests
- [ ] W-020 agent-runtime E2E
- [ ] W-021 DB migration test
- [ ] W-022 registry sync test
- [ ] W-023 worker concurrency test
- [ ] W-024 approval blocked/resume E2E
- [ ] W-025 cross review E2E
- [ ] W-026 Human Approval bypass negative test
- [ ] W-027 Prompt Injection negative test
- [ ] W-028 Tool DENY bypass negative test
- [ ] W-029 Cost limit test
- [ ] W-030 crash recovery test

# X. 建設土木ドメイン固有テスト

- [ ] X-001 港湾案件→港湾AgentへRouting
- [ ] X-002 地盤案件→地盤AgentへRouting
- [ ] X-003 構造案件→構造AgentへRouting
- [ ] X-004 施工案件→施工AgentへRouting
- [ ] X-005 CAD/BIM/CIM→対応AgentへRouting
- [ ] X-006 複合案件→複数AgentへRouting
- [ ] X-007 営業Agent→Civil Agent委譲
- [ ] X-008 施工Agent→安全Agent連携
- [ ] X-009 船舶Agent→港湾/安全Agent連携
- [ ] X-010 Quantity/Cost横断利用
- [ ] X-011 同じ数量算出Skillの複数Agent再利用
- [ ] X-012 地盤・構造の結果矛盾検出
- [ ] X-013 CAD座標系不一致検出
- [ ] X-014 単位系不一致検出
- [ ] X-015 基準版違い検出
- [ ] X-016 不足地盤条件時に推測で確定しない
- [ ] X-017 Safety CriticalでHuman Review
- [ ] X-018 Final Design DecisionをHumanへ渡す
- [ ] X-019 Final Construction DecisionをHumanへ渡す
- [ ] X-020 Cross Review結果をEvidence化

# Y. 01〜09＋Civil Agent完全実装判定

以下をすべて満たした時のみ「提示アーキテクチャが完全に機能」と判定する。

- [ ] Y-001 CTO Orchestratorが実稼働
- [ ] Y-002 Organization Agent 01〜09がRegistryに存在
- [ ] Y-003 Civil Expert Agent 9種がRegistryに存在
- [ ] Y-004 各Agentに実Skillが紐付く
- [ ] Y-005 Skillsが独立再利用可能
- [ ] Y-006 Knowledgeが実参照される
- [ ] Y-007 Tool Gatewayが実行を統制
- [ ] Y-008 Cross Reviewが実稼働
- [ ] Y-009 Human ApprovalがRuntimeを強制停止/再開
- [ ] Y-010 Policyを回避不能
- [ ] Y-011 全RunがAudit/Trace可能
- [ ] Y-012 E2Eで全経路PASS
- [ ] Y-013 負のテストでも安全側に倒れる
- [ ] Y-014 READMEの「実装済み/未実装」表記を現状へ更新
- [ ] Y-015 設計資料と実装差分がゼロ、またはBacklogとして明示

# Z. Claude Code 最終成果物

Claude Codeは検証終了時に以下を作成すること。

- [ ] Z-001 `docs/reviews/agent-skill-full-verification-report.md`
- [ ] Z-002 PASS/PARTIAL/FAIL/NOT IMPLEMENTED一覧
- [ ] Z-003 アーキテクチャ実装率
- [ ] Z-004 Organization Agent実装率
- [ ] Z-005 Civil Agent実装率
- [ ] Z-006 Skills実装率
- [ ] Z-007 Policy/Approval実装率
- [ ] Z-008 Security実装率
- [ ] Z-009 Test coverage概要
- [ ] Z-010 未実装Backlog
- [ ] Z-011 Severity Critical/High/Medium/Low分類
- [ ] Z-012 修正したファイル一覧
- [ ] Z-013 追加テスト一覧
- [ ] Z-014 実行したコマンド一覧
- [ ] Z-015 最終テスト結果
- [ ] Z-016 残存リスク
- [ ] Z-017 Production Ready / Conditional / Not Ready 判定
- [ ] Z-018 Mermaidで実際のRuntime経路図を生成
- [ ] Z-019 設計想定図との差分図を生成
- [ ] Z-020 README更新

---

# Claude Codeにそのまま渡す最終プロンプト

```text
このRepository全体を対象に、Agent / Skills / AI Runtime / Policy / Human Approval /
Knowledge / Tools / Cross Review / Security / Auditの全面検証を行ってください。

最重要の期待アーキテクチャは以下です。

User
→ CTO Orchestrator
→ Organization Agents 01〜09
→ 必要に応じ Civil Expert Agents
→ Skills
→ Knowledge + Tools
→ Cross Review
→ Human Review & Approval

添付の `Agent-Skills-AI-Runtime-Full-Verification-Checklist.md` を唯一の簡略チェックではなく
最低基準として使用し、実コード、DB、API、Worker、WebUI、テストを横断して確認してください。

重要:
- 「ドキュメントに書いてある」だけではPASSにしない。
- 「設定画面がある」だけでもPASSにしない。
- Runtimeで本当に利用・強制されることを確認する。
- mock/status-onlyと実機能を明確に分ける。
- FAIL/PARTIAL/NOT IMPLEMENTEDは可能な範囲で修正する。
- 既存機能を壊さない。
- Policy DENYを迂回させない。
- Human Approvalを迂回させない。
- T5/T6、安全・構造・最終設計・最終施工判断はAI単独確定不可。
- 本番外部サービスへの接続、秘密情報投入、本番デプロイ、不可逆操作は実行しない。
- テストDB以外を破壊しない。
- すべての修正にテストを追加する。
- `npm run test:unit` と `npm run test:e2e` を最終的にPASSさせる。

特に確認・実装するもの:
1. Orchestrator / Router / Planner
2. Organization Agents 01〜09
3. Civil Expert Agents
4. Agent Registry / Contract
5. Skill Loader / Skill Registry / Skill Evaluation
6. Knowledge Source / Evidence / Lineage
7. Tool Gateway
8. Policy Engine
9. Run Approval / Human in the Loop
10. Cross Review
11. Provider Adapter / Model Router
12. Prompt Guard
13. Worker / Queue / Retry / Idempotency
14. Audit Hash Chain
15. RBAC / SoD
16. Security negative tests
17. 建設土木ドメインE2E

最後に
`docs/reviews/agent-skill-full-verification-report.md`
を作成し、以下を明示してください。

- PASS / PARTIAL / FAIL / NOT IMPLEMENTED
- 実装率
- Critical / High / Medium / Low
- 修正ファイル
- 追加テスト
- 実行コマンド
- Test結果
- 未実装Backlog
- 残存リスク
- Production Ready / Conditional / Not Ready
- 現在の実Runtime構成Mermaid図
- 期待構成との差分
```

---

## 現時点の事前判定

Repository内のREADMEおよび実装構成から、現状は概ね以下と考える。

| 領域 | 事前判定 |
|---|---|
| PostgreSQL / 認証 / Project / Approval / Audit | 実装済み領域が多い |
| Agent Runtime P0 | 実装あり |
| Skill Loader / Registry / Policy / Tool Gateway | 実装あり |
| Prompt Guard / Provider Adapter / Evaluation | 実装あり |
| みらい建設向け限定Agent / Skill | P1として実装あり |
| Organization Agents 01〜09 全体系 | 完全実装は要確認・不足可能性大 |
| Civil Expert Agents 全体系 | P2 Backlog要素が残る |
| CTO Orchestrator完全自律Routing | 完全実装は要確認 |
| Cross Review完全フロー | 独立機能として要確認 |
| Notion/Slack/Gmail/GitHub実自動連携 | README上、状態管理中心の領域あり |
| 全体構成の完全E2E | このチェックリストで最終確認必須 |

したがって、現時点では **「設計思想に沿った共通Agent/Skill Runtimeは存在するが、提示された全Agent階層・全専門Agent・Cross Reviewまで含む完成形が全面稼働しているとはまだ判定できない」** とする。
