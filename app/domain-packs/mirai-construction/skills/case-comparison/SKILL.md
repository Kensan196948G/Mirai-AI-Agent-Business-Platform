---
name: case-comparison
description: "施工実績候補間の類似・相違・不明条件を比較する。案件の受注可否・工法決定は行わない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`project-case-search`が返した実績候補を、条件（工種・規模・地域区分等、`summary`記載範囲内）で比較する。

## 起動条件

- 前Stepの`candidates`が1件以上ある。

## 使わない条件

- `candidates`が0件の場合はスキップする。

## 必要入力

- `candidates`（前Stepの出力）
- `query`

## 手順

1. 各候補の`summary`から類似点・相違点を構造化整理する。
2. `summary`に記載のない条件（現場固有の制約等）は`unknowns`に分離する。

## 許可されたTool

- （Tool呼び出しなし。構造化LLM出力のみ）

## 保留・失敗条件

- 比較根拠が`summary`に無い軸は「不明」として出力する。

## 成果物形式

`{ comparisons: [{source_record_id, similarities: string[], differences: string[]}], unknowns: string[] }`

## 根拠

各`comparisons`エントリは`source_record_id`に紐づく。

## 専門家確認事項

最終的な提案適用可否は営業・施工担当の確認を要する。
