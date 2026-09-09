---
name: quantity-consistency-check
description: "数量・金額の記述（「項目: 数値 単位」の行）から、単位の不一致・合計の不整合・欠落を機械的に検出する。推定はしない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

数量拾い・予算表の整合確認（Quantity Takeoff / Budget & Cost Analysis の下準備）。

## 起動条件

- 数量や金額の行が渡されたとき。

## 使わない条件

- 数量そのものの算出・見積の確定を求められたとき。

## 必要入力

- `quantities_text`（複数行）、`query`

## 手順

1. 各行を「項目: 数値 単位」として解析する
2. 同じ項目名で単位が異なる行、「合計」行と明細の和の不一致、数値の無い行を検出する
3. 草案として保存する（quantities_text が無ければ棄権）

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 解析できない行は unknowns に列挙する。

## 成果物形式

`{ parsed:[{label, value, unit}], issues, unknowns, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

入力テキストの機械的解析のみ。

## 専門家確認事項

数量・金額の正否は積算担当が確認する。
