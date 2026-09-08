---
name: outcome-measurement
description: 実測された作業時間・利用量・人間修正量を集計する。効果の誇張表現は生成しない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`agent_runs`・`run_events`・`artifacts`の実測値（Step数、所要時間、Token、費用、
人間レビューでの修正有無）を集計し、KPI算出の元データを作る。

## 起動条件

- 運用者・評価担当が任意のタイミングでバッチ実行する（Agent Run内のStepではない）。

## 使わない条件

- 実測データが無い期間・Agentは集計対象から除外する（推測値で埋めない）。

## 必要入力

- `agent_id`（任意）、`from`/`to`（期間）

## 手順

1. 対象期間の`agent_runs`・`run_events`・`artifacts.reviewed_at`を集計する。
2. 人手作業時間との比較は、比較対象の人手実測値が別途登録されている場合のみ算出する
   （登録が無ければ`unknowns`に記録し、削減率を作らない）。

## 許可されたTool

- （Tool呼び出しなし。集計処理のみ）

## 保留・失敗条件

- 母数が0件の期間はエラーではなく「データなし」として返す。

## 成果物形式

`{ agent_id, run_count, avg_steps, avg_tokens, avg_cost, human_review_rate, unknowns: string[] }`

## 根拠

`agent_runs`/`run_events`/`artifacts`の実測値のみを使用する。

## 専門家確認事項

削減率等の効果指標は、実測前に作成しない（本文中の指示どおり）。
