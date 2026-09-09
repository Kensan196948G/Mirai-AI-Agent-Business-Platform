---
name: engineering-consistency-check
description: "数値・単位・座標系・基準面の記述を機械的に照合し、単位系の混在（m/ft、kN/tf）、座標系の不一致（JGD2011/JGD2000/WGS84 等）、基準面（T.P./D.L./C.D.L.）の混在を検出する。推定はしない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

複数の資料・Agent 出力に跨る数値・単位・座標系の整合を確認する（D-018 / X-013 / X-014）。

## 起動条件

- 専門 Agent の中間 Step、または Cross Review の前。

## 使わない条件

- 数値の正否そのものの検証（設計計算）を求められたとき。

## 必要入力

- `query`、`technical_text`（任意。数値・座標を含む本文）、先行 Step の findings

## 手順

1. 本文と先行 Step の事実から単位（m, mm, ft, kN, tf, m3 等）、座標系名、基準面名を抽出する
2. 同じ量の単位系が混在、座標系が複数、基準面が複数の場合を issues に列挙する
3. 抽出できなければ unknowns に記録する

## 許可されたTool

- `artifact.write-draft`（草案の保存。人手確認固定）

## 保留・失敗条件

- なし。

## 成果物形式

`{ units_found, coordinate_systems, datums, issues, unknowns }`

## 根拠

正規表現による抽出。

## 専門家確認事項

座標系・基準面の確定は測量・設計担当が行う。
