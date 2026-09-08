---
name: project-case-search
description: 承認済みの施工実績（source_records、source_type=project_case）を検索する。提案の正式内容・受注可否の決定は行わない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

利用者の相談内容に関連する承認済み施工実績を検索する。`technology-catalog-search`と同じ
`knowledge.search-approved` Toolを、`source_type='project_case'`で絞り込んで使う点のみ異なる。

## 起動条件

- `project-case-research` Agentの最初のStep。

## 使わない条件

- 個人情報・位置情報・顧客の非公開情報を含む入力では起動しない（Policy Engineが拒否）。

## 必要入力

- `query`（string）

## 手順

1. `knowledge.search-approved`を`source_type='project_case'`で呼び出す。
2. ヒットをそのまま返す（推測補完しない）。

## 許可されたTool

- `knowledge.search-approved`

## 保留・失敗条件

- 0件ヒットは正常終了（`unknowns`に記録）。

## 成果物形式

`{ candidates: [{source_record_id, title, summary}], unknowns: string[] }`

## 根拠

各候補は`source_record_id`で追跡可能。

## 専門家確認事項

実績の類似性判定は`case-comparison`と営業・施工担当のレビューに委ねる。
