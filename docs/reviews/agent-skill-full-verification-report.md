# Agent / Skills / AI Runtime 全面検証報告（作成中）

基準: `docs/Agent-Skills-AI-Runtime-Full-Verification-Checklist.md` ／ 対象 Repository: `Kensan196948G/Mirai-AI-Agent-Business-Platform`
最終更新: 2026-09-09（第 3 段） ／ 状態: **作成中**（第 5 段の完了時に PASS / PARTIAL / FAIL / NOT IMPLEMENTED の全項目判定、実装率、Severity、Mermaid 図を確定する）

## 進め方（段階）

| 段 | 内容 | 状態 |
|---|---|---|
| 第 1 段 | 司令塔（CTO Orchestrator）: 計画（Agent 選択理由・順序）、複数 Run の実行、統合、上限、監査 | 実装済み（本報告の PR） |
| 第 2 段 | 組織責務 Agent 01〜09 の実定義と Skill（共通 Skill の再利用、評価ケース） | 実装済み（PR: 組織責務 Agent） |
| 第 3 段 | 土木専門 Agent 9 種（入出力契約、技術リスク T1〜T6、単位・数値整合） | 実装済み（PR: 土木専門 Agent） |
| 第 4 段 | Cross Review（独立レビュー、矛盾検出、PASS / CONDITIONAL / FAIL、Human Review 強制） | 未着手 |
| 第 5 段 | 残項目の是正、全項目判定、実装率、Severity、Runtime 経路図と期待構成との差分、README 更新 | 未着手 |

## 第 1 段で確認・実装した項目（抜粋）

| 項目 | 判定 | 根拠 |
|---|---|---|
| B-001〜B-004 Orchestrator の責務・要求受付・意図分類・組織 Agent 選択 | PASS | `app/src/agent-runtime/orchestrator.js`、E2E「司令塔（CTO Orchestrator）」 |
| B-006〜B-010 Skill 候補選択・分解・順序・並列識別・依存制御 | PARTIAL | Agent 単位の分解と依存順序は実装。Skill 単位の選択は Agent 契約に従う（Agent 内 Skill 順は固定） |
| B-011〜B-014 選択理由の記録・リスク考慮・DENY 時に迂回しない | PASS | 計画の `plan_json`（理由・却下理由）と監査ログ、候補 / 未承認は却下 |
| B-015 Approval Required で停止 | PASS | 配下 Run の approval_gate（C-13）がそのまま効く |
| B-016〜B-017 失敗を成功扱いしない・部分成功 | PASS | `partial` と統合草案の「結果なし」明示 |
| B-018 タイムアウト | PARTIAL | LLM タイムアウトと Lease のみ。司令塔全体の時間上限は第 5 段 |
| B-019〜B-022 Step 上限・無限呼出し防止・予算・Token/Cost | PASS | `ORCHESTRATION_MAX_STEPS` / `ORCHESTRATION_BUDGET_USD`、Agent 間の再帰呼出しなし |
| B-023〜B-025 統合・不足の明示・人間最終判断 | PASS | 統合草案は人間レビュー必須、不足を unknowns へ |
| B-005 Civil Expert Agent の追加選択 | PASS（第 3 段） | 組織責務 Agent の delegates_to × 専門 Agent の keywords で後段に委譲。LLM 提案も同じ規則で検証 |

## 第 2 段で確認・実装した項目（抜粋）

| 項目 | 判定 | 根拠 |
|---|---|---|
| C01〜C09 の -01（Agent 定義あり） | PASS | `agents/{governance,sales-opportunity,construction-planning,research-technology,safety-quality-environment-review,management-planning,branch,vessel-operation,external-dx}-support.yaml`、E2E「組織責務 Agent 01〜09」 |
| C01-06〜08 KPI Review / Decision Log / SoD Check | PASS | kpi-review（実測のみ）/ decision-log-draft（常に未決定）/ sod-check |
| C01-09, C03-09, C05-08, C08-08 等「AI 単独確定しない」 | PASS | 全草案 requires_human_review=true、決定ログは undecided、Safety は requires_expert_review |
| C02-05 Similar Project Search / C02-06 委譲 | PASS / PARTIAL | knowledge-brief（project_case）。委譲先は delegates_to に定義（司令塔経由の自動委譲は第 3 段） |
| C03-07 Quantity Takeoff / C06-03 Budget & Cost | PARTIAL | quantity-consistency-check は整合検出のみ（数量算出はしない・データ未登録） |
| C04-06 Standard Search / C04-07 Patent Search | PARTIAL / NOT IMPLEMENTED | 基準は出典種別 standard を検索（登録待ち）。特許検索は外部 DB 未接続 |
| C06-02〜C06-05 事業計画・予算・ROI・報告 | PARTIAL | planning-brief と kpi-review で論点・実測を整理。財務データは未登録 |
| C07-02〜C07-04 Context 注入 / C07-08 データ境界 | PARTIAL | regional-context で地域・顧客文脈と出典分類を固定。支店別データは未登録 |
| C09-08〜C09-09 顧客境界・社内データ非共有 | PARTIAL | external-dx-support は public_only の出典に限定。テナント分離（DB レベル）は未実装 |
| E-007〜E-015 Allowed Skills / Tools / Risk / Review / Input / Output / Timeout / Cost | PASS | Agent 契約（input_contract、technical_risk_class、timeout_seconds、budget_usd、params）と Skill 契約 |
| F-009 複数 Agent からの Skill 再利用 | PASS | 共通 Skill 9 種を 9 Agent が params 付きで共用 |

## 第 3 段で確認・実装した項目（抜粋）

| 項目 | 判定 | 根拠 |
|---|---|---|
| D-001〜D-009 土木専門 Agent 9 種 | PASS | `agents/{port-marine,geotechnical,structural,construction-planning,bim-cim-cad-gis,environmental,maintenance,quantity-cost,civil-review}-expert.yaml`、`org-map.yaml civil_experts`、E2E「土木専門 Agent 9 種」 |
| D-010 / D-011 入力・出力契約 | PASS / PARTIAL | input_contract（query, technical_text, quantities_text, document_text）。出力は Skill の output schema と草案形式（Agent 単位の出力 schema は未定義） |
| D-012 / D-013 許可 Skill / 禁止 Tool | PASS | skills[] と各 Skill の allowed_tools / forbidden_actions（equipment.control, external.send, formal-approval.decide, knowledge.auto-promote） |
| D-014 技術リスク分類 | PASS | technical_risk_class（civil_expert では必須）。Run と成果物に固定 |
| D-015 T3 以上で専門技術者 Review | PASS | artifacts.expert_review_required、review API は expert_confirmed 必須（Knowledge Curator 不可） |
| D-016 T5/T6 は AI 単独完了不可 | PASS | artifacts.ai_completion_prohibited、review API は expert_note 必須。structural-expert は T5 |
| D-017 Civil Agent 同士の結果衝突検出 | PARTIAL | engineering-consistency-check が prior_context の事実を横断照合（単位・座標系・基準面）。数値矛盾の意味的検出は第 4 段 Cross Review |
| D-018 数値・単位・座標系の整合 | PASS | engineering-consistency-check、quantity-consistency-check |
| D-019 根拠基準の版 / 発行元 | PASS | standard-reference-check（version / published_at / effective_to / canonical_url）。社内基準は未登録（B-10）を明示 |
| D-020 不明条件を補完しない | PASS | condition-gap-register が required_conditions を照合し、無いものを未確定として unknowns へ |
| X-001〜X-005 案件種別ごとの Routing | PASS | ユニット「ルーティング（X-001〜X-020）」: 9 種それぞれの専門用語で選ばれ、委譲元を持つ |
| X-006 複合案件 → 複数 Agent | PASS | scriptedPlan は組織 Agent 複数 + 専門 Agent（上限 6） |
| X-007〜X-009 営業 / 施工 / 船舶からの委譲 | PASS | sales-opportunity-support → 港湾・地盤・数量、construction-planning-support → 施工・港湾・数量・環境、vessel-operation-support → 港湾・環境 |
| X-010 / X-011 Quantity / Cost の横断利用 | PASS | quantity-consistency-check を 03 / 06 / 施工計画専門 / 数量専門が共用 |
| X-012 地盤・構造の結果矛盾検出 | PARTIAL | 単位・座標系・基準面の混在は検出。地盤定数と構造前提の意味的矛盾は第 4 段 |
| X-013〜X-015 座標系 / 単位系 / 基準版の不一致 | PASS | engineering-consistency-check（JGD2011 vs JGD2000、kN vs tf、ft vs m、T.P. vs D.L.）、standard-reference-check（複数版） |
| X-016 不足地盤条件で推測しない | PASS | E2E: 地下水位の記載なし → 未確定条件として登録、present に含めない |
| X-017 Safety Critical で Human Review | PASS | T3 以上は専門技術者確認、全草案 requires_human_review |
| X-018 / X-019 最終設計・施工判断を人間へ | PASS | Agent の does_not と T5 の ai_completion_prohibited。統合草案も人間レビュー必須 |
| X-020 Cross Review 結果の Evidence 化 | NOT IMPLEMENTED | 第 4 段 |
| 第 2 段の欠陥修正 | FIXED | Run 固定版の Skill 一覧（`getAgentVersionById`）が束縛 params を返しておらず、組織責務 Agent の params（plan_type 等）が実行時に渡っていなかった。E2E で params の到達を検証 |

## 未実装 Backlog（現時点）

- Cross Review（第 4 段）: 独立レビュー、矛盾検出、PASS / CONDITIONAL / FAIL、Evidence 化（X-020、D-017 の意味的矛盾）
- 承認の期限・差戻し・Evidence 必須（J-006〜J-010）、Tool 結果の schema 検証（H-020）、Circuit Breaker（H-017）、API の pagination（S-015）など第 5 段で是正

以降の段で本報告を更新する。
