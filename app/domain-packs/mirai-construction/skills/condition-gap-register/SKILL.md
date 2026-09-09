---
name: condition-gap-register
description: "専門分野ごとに必要な条件（例: 地盤なら N 値・土質・地下水位）が相談文・先行資料に書かれているかを機械的に確認し、無いものを「未確定」として登録する。推測で補完しない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

不明条件を勝手に補完せず、未確定条件の一覧（gap register）を作る。専門 Agent の最初の Step。

## 起動条件

- 専門 Agent の起動時。

## 使わない条件

- 条件が明示的にすべて揃っていることが分かっているとき（それでも実行して問題ない）。

## 必要入力

- `query`、`required_conditions`（Agent 契約の params で固定）、先行 Step の findings / candidates

## 手順

1. required_conditions の各項目について、相談文と先行 Step の事実に該当する語があるかを照合する
2. 無い項目を missing_conditions に、あった項目を present_conditions に分ける
3. missing は unknowns にも「未確定条件: …」として積む（後続 Step が推測しないための入力）

## 許可されたTool

- `artifact.write-draft`（草案の保存。人手確認固定）

## 保留・失敗条件

- なし（missing が多くても失敗にしない）。

## 成果物形式

`{ present_conditions, missing_conditions, unknowns }`

## 根拠

語の照合のみ。

## 専門家確認事項

未確定条件の実測・入手は専門技術者が行う。
