---
name: regional-context
description: "支店・営業所の地域文脈（組織情報・対象地域・利用できる出典の範囲）を明示し、地域外・社外のデータ境界を守るための前提を出力する。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

07 支店 Agent と 09 社外向け DX Agent の最初の Step。地域／顧客の文脈と、利用できる出典の分類（public のみ等）を固定する。

## 起動条件

- 支店・顧客単位の相談の最初に呼ぶ。

## 使わない条件

- 地域・顧客の指定が無いとき（unknowns に記録して続行）。

## 必要入力

- `branch`（支店名・地域、任意）、`customer`（顧客名、任意）、`allowed_classification`（Agent 契約の params で固定）

## 手順

1. org-map の組織情報から地域文脈を組み立てる
2. allowed_classification を後続 Step の classification に設定する（社外向けは public のみ）
3. 本システムに地域別データ（支店 KPI・地域案件）が無いことを unknowns に明示する

## 許可されたTool

- （Tool 呼び出しなし。ローカル処理のみ）

## 保留・失敗条件

- なし。

## 成果物形式

`{ region, customer, classification, scope_note, unknowns }`

## 根拠

org-map.yaml の定義。

## 専門家確認事項

地域固有の判断は支店長・営業所長が行う。
