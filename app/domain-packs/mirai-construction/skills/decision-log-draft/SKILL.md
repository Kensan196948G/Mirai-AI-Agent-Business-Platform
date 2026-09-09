---
name: decision-log-draft
description: "論点・選択肢・考慮事項・必要な承認者を整理した意思決定ログの草案を作る。決定状態は常に「未決定」。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

委員会・経営会議・技術判断の記録様式（Decision Log）を先行 Step の事実から下書きする。

## 起動条件

- 組織責務 Agent の最終 Step として記録様式を作るとき。

## 使わない条件

- 決定そのものを求められるとき（AI は決定しない）。

## 必要入力

- `query`、`options`（任意）、先行 Step の findings / unknowns / items

## 手順

1. 先行 Step の事実・不明点・論点を考慮事項として集める
2. 決定状態を「未決定」、必要承認者を「人間（該当ロール）」として草案を保存する

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 入力が無くても様式は作る（内容は空欄と不明点）。

## 成果物形式

`{ decision_status: "undecided", topic, options, considerations, unknowns, approvers_required, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

considerations は先行 Step の出力の転記。

## 専門家確認事項

決定と承認は正式な会議体・desknet's NEO で行う。
