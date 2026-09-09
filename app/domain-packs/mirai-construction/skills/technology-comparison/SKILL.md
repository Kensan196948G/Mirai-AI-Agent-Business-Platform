---
name: technology-comparison
description: "技術候補間の比較表を作成する。適用条件・不足情報を候補ごとに並べ、同一視できない相違点（警報機能の有無等）を明示する。工法決定は行わない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`applicability-gap-check`の出力を候補間で並べ、目的別（コスト・工期・適用範囲等）の比較表を作る。

## 起動条件

- 前Stepの`gaps`が1件以上ある。

## 使わない条件

- `gaps`が0件の場合はこのStepをスキップする。

## 必要入力

- `gaps`（前Stepの出力）

## 手順

1. 候補ごとの`confirmed`/`missing`を表形式に整形する。
2. 機能・条件が異なる候補を安易に「同等」と表現しない（例：警報機能の有無を混同しない）。
3. 比較軸（コスト・工期・適用範囲等）は`confirmed`に記載がある範囲でのみ埋め、無い場合は空欄+`unknowns`に記載する。

## 許可されたTool

- （Tool呼び出しなし。構造化LLM出力のみ）

## 保留・失敗条件

- 比較軸を裏付ける`confirmed`情報が無い場合、その軸は「不明」として出力し、断定しない。

## 成果物形式

`{ comparison_table: [{source_record_id, axis, value, basis}], unknowns: string[] }`

## 根拠

`comparison_table`の各行は`source_record_id`と`basis`（引用元の`confirmed`文言）を持つ。

## 専門家確認事項

比較表全体を、技術専門家が最終レビューすることを前提とする。
