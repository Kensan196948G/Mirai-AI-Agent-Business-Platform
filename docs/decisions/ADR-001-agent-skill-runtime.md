# ADR-001: Mirai Agent／Skill 共通実行基盤（P0）とみらい建設 Domain Pack（P1）の導入

- 日付: 2026-09-08
- 起票: Claude Code（ユーザー指示に基づく段階実装。設計参考: `docs/Mirai-Agent-Skill-Architecture.md`）
- ステータス: 承認済み（P0/P1の範囲。P2/P3は無効なカタログ・Backlogのみ）

## 背景

`app/`（Mirai AgentOS。本リポジトリの「自前アプリ開発なし」方針に対する2026-09-08の明示的例外）には、
これまで `agents_config` / `skills_registry` / `model_router` という**設定台帳のみ**が存在し、
実際にAgentがSkillを使ってタスクを自律実行する仕組みは無かった（`app/README.md` の
「🧩 何が本物で、何がまだ人手か」に明記済み）。

ユーザーより、みらい建設工業向けの業務Agent／Skillを段階実装する指示があった。本ADRは
その導入範囲・境界・既存資産との関係を記録する。

## 決定

1. **既存`app/`を拡張する。置き換えない。** 別リポジトリ・別DB・別フレームワークへの移行は行わない。
   モジュラーモノリス＋別Workerプロセスを採用し、永続ジョブは既存PostgreSQLを使う
   （外部キュー・ベクトルDB・Kubernetes・マイクロサービス化は今回導入しない）。

2. **今回実装するのはP0（共通実行・統制基盤）とP1（初期3Agent・12Skill）のみ。**
   P2（港湾・地盤・維持管理・安全品質環境・研究等の業務拡張）・P3（専門システムとの外部連携）は、
   無効化されたカタログエントリとBacklogとして記録するに留め、実行可能にしない。

3. **正式な業務承認の正本はdesknet's NEO Workflowのまま変更しない。** アプリ内の
   Artifactレビュー（人間が草案を確認する行為）と、正式なGate承認は明確に区別する。
   NEO連携仕様・資格情報は本セッションでは未確認のため、正式承認を要する処理（P1では発生しない）は
   `blocked` として扱い、手入力の承認番号や成功のふりをするMockでは通さない。

4. **初期3Agentは検索・比較・草案作成（実行レベルA0〜A1）までに限定する。**
   外部への書き込み（Notion確定登録・Slack送信等、A2）、設備・船舶制御や警報変更（A3）は
   本実装のToolに一切含めない。

5. **初期データは、`docs/Mirai-Agent-Skill-Architecture.md` が既に確認した公開マーケティング情報
   （evidence_type: `marketing_overview`）と、リポジトリ内で作成する合成Fixtureに限定する。**
   個人情報・位置情報・社外秘は入力・外部AI送信しない。本セッションでは追加のWebFetchは行わず、
   同ドキュメントが2026-09-08時点で確認済みの公式サイト要約とURLをそのまま出典として使う
   （再取得していない旨を明記する）。

6. **既存の未実装・設定のみの機能を「削除」ではなく「投影」として活かす。**
   `agents_config` / `skills_registry` はUI互換のための投影ビューとして維持し、
   実体は新設の版付きテーブル（`agent_versions` / `skill_versions` 等）に持たせる。

## 発見した既存実装の弱点（本ADRで対処する）

調査の結果、`docs/Mirai-Agent-Skill-Architecture.md` の指摘どおり以下を確認した。P0の一部として
修正する（詳細は各PRの説明を参照）。

| ファイル | 問題 | 対処 |
|---|---|---|
| `app/src/routes/approvals.js` | 申請者本人が自分の申請を承認できる。Administratorが対象ロールに関わらず全stepを代理承認できる | 自己承認拒否チェックを追加。Administrator代理承認は監査ログへの明示記録を追加（今回は代理承認機能自体は既存要件のため維持するが、自己承認のみ禁止する） |
| `app/src/routes/tasks.js` | `PATCH /api/tasks/:id` が任意のstatus/cost/tokensを誰でも書き換えられ、Runtime管理Runの実行結果を偽装できる | `tasks.source`（manual/runtime）列を追加し、`source='runtime'`の行はこのAPI経由の直接更新を拒否する |
| `app/src/lib/audit.js` | 32bit簡易ハッシュチェーンで暗号学的な改ざん防止ではない | 今回のスコープでは強化しない（既存の「軽量Hash Chain」という位置づけを維持し、README等で暗号学的証跡と誤認させない記載を保つ） |
| `app/test/e2e.test.mjs` | DATABASE_URLに`test`という文字列が含まれるかのみで破壊的テストを許可 | 本ADRでは変更しない（既存の安全策として妥当な最低限は満たしている。追加のDB名許可リスト等はBacklog） |

## 概念モデルとテーブル設計

`docs/Mirai-Agent-Skill-Architecture.md` §6, §11 の設計を踏まえ、以下のテーブルを
`app/migrations/005_agent_runtime.sql` として追加する（既存テーブルは可能な範囲で再利用）。

- `agent_versions` / `skill_versions`：版・内容ハッシュ・承認状態を持つRegistry本体
- `agent_skill_bindings`：Agent版とSkill版の関連
- `agent_runs`：永続Run（Lease/Heartbeat/Checkpoint/Step/Attempt/予算予約）
- `run_events`：Run内の追記型イベントログ（Step開始・Tool呼び出し・完了等）
- `artifacts` / `artifact_citations`：成果物と、根拠となる`source_records`への引用
- `source_records`：出典・版・内容ハッシュ・利用条件・レビュー状態を持つ知識ソース台帳
- `budget_reservations`：Run単位のLLM予算予約・精算

`effect_ledger`（外部副作用の冪等台帳）は**スキーマとして用意するが今回のP1では未使用**とする
（P1の3AgentはA0〜A1のみで外部書き込みを行わないため）。P2/P3で外部書き込み（A2）を追加する際に
実配線する前提のBacklog項目とする。

`tasks` / `knowledge_candidates` は、既存カラムを壊さない形で `agent_run_id` 等の参照列を追加し、
Runtime管理レコードであることを識別できるようにする。

## Tool Gateway の許可Tool（P1）

以下の型付きToolのみを許可する。任意のShell/SQL/URL取得/動的JavaScriptは許可しない。

- `knowledge.search-approved`：`source_records`（承認済み・classification='public'のみ）を検索
- `source.read-approved-snapshot`：特定`source_records`の内容スナップショットを読む
- `artifact.write-draft`：`artifacts`へ草案を保存する（review_state='draft'固定、Tool自身は昇格できない）

## 段階導入の完了条件

- P0: 否定系テスト（自己承認・案件越境・未承認Skill実行・Runtime偽装）が通ること
- P1: `technology-selection` の縦断経路（技術検索→適用条件整理→比較草案→人間レビュー表示）が
  実行環境（テストDB）で最初から最後まで動作し、E2Eで検証されていること。
  `project-case-research` / `knowledge-quality` は同じRuntime部品を再利用して実装するが、
  セッション制約により完全な検証が間に合わない場合はその旨を最終報告のBacklogに明記する。

## 却下した代替案

- **別リポジトリ / 別サービスとして新規構築**：既存の認証・案件・承認・監査基盤を二重に持つことになり、
  正本が分散するため却下。
- **外部Agentフレームワーク（LangGraph等）の導入**：本リポジトリの「外部依存を最小に保つ」方針
  （ルートの`tools/check-docs.mjs`が外部npm依存ゼロで動く設計思想）と、依存追跡・監査のしやすさを
  優先し、既存Express＋PostgreSQLの範囲で自作することを選択。YAML解析用に`js-yaml`のみを
  `app/package.json`へ追加する（SKILL.md/execution.yaml/pack.yamlの構造化データを読むために必須）。
