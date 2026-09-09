---
name: document-review
description: "提供された文書テキストを観点（criteria）に沿ってレビューし、指摘・重大度・引用箇所・不明点を返す。文書が無ければ棄権する。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

安全計画・品質計画・環境計画・セキュリティ評価・提案書などの文書レビュー草案を作る。合否判定はしない。

## 起動条件

- 利用者が文書テキストを渡し、観点に沿った指摘を求めるとき。

## 使わない条件

- 文書テキストが無いとき（棄権する）。合否・承認の判定を求められるとき。

## 必要入力

- `document_text`（レビュー対象）、`criteria`（観点。Agent 契約の params で固定）、`query`

## 手順

1. document_text が無ければ「文書が提供されていません」として棄権し草案を保存する
2. LLM に文書と観点を渡し、観点ごとの指摘（finding）・重大度・引用箇所を JSON で返させる
3. 検証して草案として保存（requires_human_review と requires_expert_review は常に true）

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 検証失敗は保留草案。重大度は参考値で、安全・構造に関わる判断は専門家が行う。

## 成果物形式

`{ issues:[{criterion, finding, severity, quote}], unknowns, requires_human_review: true, requires_expert_review: true, artifact_id, artifact_code }`

## 根拠

指摘は文書の引用（quote）を伴う。文書に無いことを指摘しない。

## 専門家確認事項

安全・品質・環境・セキュリティの最終判断と承認は担当部門の人間が行う。
