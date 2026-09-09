# Agent / Skills / AI Runtime 全面検証報告（作成中）

基準: `docs/Agent-Skills-AI-Runtime-Full-Verification-Checklist.md` ／ 対象 Repository: `Kensan196948G/Mirai-AI-Agent-Business-Platform`
最終更新: 2026-09-09（第 2 段） ／ 状態: **作成中**（第 5 段の完了時に PASS / PARTIAL / FAIL / NOT IMPLEMENTED の全項目判定、実装率、Severity、Mermaid 図を確定する）

## 進め方（段階）

| 段 | 内容 | 状態 |
|---|---|---|
| 第 1 段 | 司令塔（CTO Orchestrator）: 計画（Agent 選択理由・順序）、複数 Run の実行、統合、上限、監査 | 実装済み（本報告の PR） |
| 第 2 段 | 組織責務 Agent 01〜09 の実定義と Skill（共通 Skill の再利用、評価ケース） | 実装済み（PR: 組織責務 Agent） |
| 第 3 段 | 土木専門 Agent 9 種（入出力契約、技術リスク T1〜T6、単位・数値整合） | 未着手 |
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
| B-005 Civil Expert Agent の追加選択 | NOT IMPLEMENTED | 第 3 段で専門 Agent を定義後に有効化 |

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

## 未実装 Backlog（現時点）

- 組織責務 Agent 01〜09（第 2 段）、土木専門 Agent 9 種（第 3 段）、Cross Review（第 4 段）
- 承認の期限・差戻し・Evidence 必須（J-006〜J-010）、Tool 結果の schema 検証（H-020）、Circuit Breaker（H-017）、API の pagination（S-015）など第 5 段で是正

以降の段で本報告を更新する。
