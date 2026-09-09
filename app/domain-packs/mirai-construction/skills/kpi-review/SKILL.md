---
name: kpi-review
description: "本システムに実測がある KPI（Run 完走率・費用・レビュー率・承認待ち・出典数・Knowledge 状態）を集計して返す。実測が無い業務 KPI は「未登録」と明示する。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

経営・管理向けの KPI レビュー草案。推定値を出さない。

## 起動条件

- KPI の現状把握を求められたとき。

## 使わない条件

- 受注・売上・利益など本システムに無い KPI の数値を求められたとき（未登録と返す）。

## 必要入力

- `query`、`scope`（任意）

## 手順

1. agent_runs / artifacts / approval_requests / source_records / knowledge_candidates を読み取り専用で集計する
2. 業務 KPI（受注・売上等）は本システムに無いため unknowns に明示する
3. 草案として保存する

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 集計対象が無くても失敗にせず 0 件として返す。

## 成果物形式

`{ kpis:[{name, value, unit, source, period}], unknowns, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

全て DB の実測値。

## 専門家確認事項

数値の解釈と評価は経営企画・管理本部が行う。
