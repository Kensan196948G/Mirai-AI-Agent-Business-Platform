---
name: technology-catalog-search
description: "承認済みの技術カタログ（source_records）から、案件条件に関連する技術候補を検索する。技術選定の事前調査に用い、施工可否の最終決定は行わない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

利用者が入力した業務条件（例：「汚濁防止膜と作業船の管理に関係する保有技術」）に関連する
承認済み技術カタログエントリ（`source_records`、classification=public、status=approved）を検索する。

## 起動条件

- `technology-selection` Agentの最初のStepとして起動する。
- 検索クエリ（自然文）が1件以上与えられている。

## 使わない条件

- 個人情報・位置情報・社外秘を含む入力が検出された場合は起動しない（Policy Engineが事前に拒否する）。
- 承認済みカタログが1件もヒットしない場合は `unknowns` に記録し、次のStepへは空候補で進む（棄権を許容する）。

## 必要入力

- `query`（string）：利用者の相談内容の要約
- `project_id`（number, 任意）：案件スコープの絞り込み

## 手順

1. `knowledge.search-approved` Toolを呼び出し、`source_type` を技術カタログ関連に絞って検索する。
2. ヒットした`source_records`の`id`・`title`・`summary`・`evidence_type`をそのまま返す（要約の言い換え・推測補完はしない）。
3. ヒット数が0件の場合は `unknowns` へ「該当する承認済み技術カタログが見つからない」旨を記録する。

## 許可されたTool

- `knowledge.search-approved`

## 保留・失敗条件

- Tool呼び出しがエラーになった場合はStepを`failed`とし、Runtimeのリトライ上限に従う。
- 検索結果が0件は失敗ではなく正常終了（`unknowns`に記録）とする。

## 成果物形式

`{ candidates: [{source_record_id, title, summary, evidence_type}], unknowns: string[] }`

## 根拠

各候補は`source_record_id`で`source_records`テーブルへ追跡可能。要約はDBの`summary`列をそのまま使い、
Skill自身が新しい技術的主張を生成しない。

## 専門家確認事項

該当技術が実際の案件条件に適用可能かどうかは、後続の`applicability-gap-check`および技術専門家のレビューに委ねる。
