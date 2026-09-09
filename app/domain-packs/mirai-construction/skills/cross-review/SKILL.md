---
name: cross-review
description: "複数 Agent の成果物（事実・不明点・前提・出典）を横断し、数値・単位・前提・出典の矛盾と根拠のない主張を検出して PASS / CONDITIONAL / FAIL と confidence を返す独立レビュー。一次 Agent とは別のモデル分類（Independent Review）を使い、同じ回答をそのまま追認しない。FAIL は人間レビューを強制する。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

司令塔が集めた複数 Agent の成果を独立にレビューし、相互矛盾（数値・単位・座標系・基準面・前提・出典・リスク評価）と未確認事項を抽出して、PASS / CONDITIONAL / FAIL の判定と confidence を Evidence として残す。

## 起動条件

- 司令塔の最終 Step として、他の Step が終了し 1 件以上の成果があるとき。

## 使わない条件

- 成果が 1 件も無いとき（司令塔が skipped にする）。
- 技術的な合否・設計判断を求められたとき（人間が行う）。

## 必要入力

- `query`（元の要求）、`prior_context`（各 Agent の artifact_code / findings / unknowns / assumptions / sources）

## 手順

1. 機械検査: Agent 間で同じ量（ラベル + 単位）の数値が異なるものを「数値矛盾」、単位系・座標系・基準面の混在を「単位矛盾」、根拠（sources）の無い事実を「根拠なし」として列挙する。
2. 独立レビュー（Independent Review 分類のモデル）: 前提条件・出典・リスク評価の矛盾、異論（少数意見）、未確認事項を抽出し、判定と confidence を返す。LLM が使えなければ機械検査のみで判定し、その旨を明示する。
3. 判定の強制: 数値矛盾があれば FAIL、単位矛盾・根拠なしがあれば CONDITIONAL 以上。LLM の判定は機械検査より緩められない。独立レビュー未実施のときは PASS にしない。
4. FAIL は human_review_forced=true。判定・矛盾・confidence を草案（cross_review）として保存する。

## 許可されたTool

- `artifact.write-draft`（判定の Evidence 化。人手確認固定）

## 保留・失敗条件

- prior_context が空: 判定不能（CONDITIONAL、confidence 0）。

## 成果物形式

`{ verdict, confidence, contradictions:[{type, detail, agents}], unsupported_claims, minority_opinions, unknowns, review_source, human_review_forced }`

## 根拠

機械検査は正規表現、独立レビューは prior_context の内容のみ。基準本文・外部情報は使わない。

## 専門家確認事項

FAIL / CONDITIONAL の矛盾は専門技術者が確認する。PASS でも最終判断は人間が行う。
