---
name: knowledge-quality-review
description: Knowledge候補の正確性・具体性・再利用性・機密性を検査し、人間レビュー用の指摘一覧を作る。自己昇格はしない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`knowledge_candidates`（status='pending'）を対象に、根拠の有無・具体性・機密情報混入の疑いを検査する。

## 起動条件

- `knowledge-quality` Agentの最初のStep。対象は`status='pending'`の候補。

## 使わない条件

- 既に`promoted`/`rejected`の候補は対象外。

## 必要入力

- `knowledge_candidate_id`、`title`、`summary`、`source`

## 手順

1. `summary`に具体的根拠（出典・数値・手順）があるかを確認する。
2. 個人情報・位置情報・社外秘らしき語を検出したら`flags`に記録する。
3. 判定結果は`findings`として返す（DBの`status`は変更しない）。

## 許可されたTool

- `knowledge.search-approved`（重複確認用の参照）

## 保留・失敗条件

- 判定できない場合は`unknowns`に記録し、`requires_human_review=true`のまま返す。

## 成果物形式

`{ knowledge_candidate_id, findings: string[], flags: string[], unknowns: string[] }`

## 根拠

既存`knowledge_candidates`テーブルの内容のみを検査対象とし、新しい事実を作らない。

## 専門家確認事項

`flags`が1件でもあれば、Knowledge Curatorの確認を必須とする。
