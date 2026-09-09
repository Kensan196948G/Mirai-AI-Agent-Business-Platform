---
name: risk-assessment
description: "相談内容と文脈から、危険源（hazard）・結果・可能性・重大性・対策候補を根拠付きで列挙する。安全・海上・AI 利用などの domain に対応。自動承認しない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

Hazard Identification / Risk Assessment / Marine Safety Review / AI Risk Assessment の草案。

## 起動条件

- 計画や運用のリスクを整理する Step。

## 使わない条件

- リスクの受容・承認を決めるとき（人間が行う）。

## 必要入力

- `query`、`domain`（Agent 契約の params で固定: safety / marine / ai / general）、`context`、先行 Step の事実

## 手順

1. LLM に相談・文脈・domain を渡し、risk_items（hazard, consequence, likelihood, severity, controls, basis）を列挙させる
2. 根拠の無い項目は likelihood / severity を unknown にする
3. 検証して草案を保存（requires_expert_review は常に true）

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 検証失敗は保留草案。安全・構造に関わる項目は必ず専門家レビューへ。

## 成果物形式

`{ risk_items:[{hazard, consequence, likelihood, severity, controls, basis}], unknowns, requires_human_review: true, requires_expert_review: true, artifact_id, artifact_code }`

## 根拠

basis に根拠（出典・文脈）を記す。数値的な確率は出さない。

## 専門家確認事項

安全担当・海上工事責任者・情報システム責任者が最終判断する。
