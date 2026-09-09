---
name: planning-brief
description: "相談文・先行 Step の事実・承認済み出典から、計画や提案の論点・チェック項目を「確認済み／未確認」に分けて整理する。決定はしない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

施工計画・工程・仮設・提案・研究計画・PoC・事業計画・配船・要件発見など、plan_type に応じた論点整理の草案を作る。

## 起動条件

- 組織責務 Agent が計画・提案の論点を整理する Step。knowledge-brief の後に置く。

## 使わない条件

- 数値の確定や最終判断が求められるとき（人間が行う）。

## 必要入力

- `query`、`plan_type`（Agent 契約の params で固定）、`criteria`（観点、任意）、`candidates` / `findings`（先行 Step）、`prior_context`

## 手順

1. 先行 Step の事実と出典を入力として LLM に渡し、plan_type の観点で論点（items）を列挙させる
2. 各 item は根拠のある「confirmed」か、確認が必要な「unknown」に分ける
3. 出力を JSON Schema で検証し、草案として保存する（人手確認必須）

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- LLM 出力が検証に通らなければ「保留」の草案を保存する。根拠の無い論点は unknown にする。

## 成果物形式

`{ items:[{title, status, rationale, based_on}], unknowns, assumptions, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

items.based_on には先行 Step の source_record_id のみ。

## 専門家確認事項

計画の採用可否・数量・工程の確定は各専門 Owner が行う。
