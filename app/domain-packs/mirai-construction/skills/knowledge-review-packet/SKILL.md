---
name: knowledge-review-packet
description: knowledge-quality-reviewとknowledge-dedupの出力を、人間レビュー用の根拠・差分・未解決事項パケットにまとめてArtifactとして保存する。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`knowledge-quality` Agentの最終Step。前段の指摘・重複・矛盾を1つのレビュー用成果物へ統合する。

## 起動条件

- 前段Stepの出力が揃っている。

## 使わない条件

- 前段の`findings`/`duplicates`/`conflicts`が全て空でも、Runは失敗させず「指摘なし」として保存する。

## 必要入力

- 前段Stepの出力一式

## 手順

1. `findings`・`flags`・`duplicates`・`conflicts`・`unknowns`を統合する。
2. `artifact.write-draft` Toolで`artifacts`へ保存する（`review_state`は常に`draft`）。
3. 対象の`knowledge_candidates.agent_run_id`と`artifact_id`を紐付ける（DB更新はWorker側で実施）。

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- なし（統合処理のみで失敗しうる外部要因が無い）。

## 成果物形式

`{ knowledge_candidate_id, findings: string[], flags: string[], duplicates: integer[],
   conflicts: array, unknowns: string[], requires_human_review: true }`

## 根拠

前段Skillの出力をそのまま集約する。

## 専門家確認事項

このパケットを見たKnowledge Curatorが、既存の`PATCH /api/knowledge/:id`で
promoted/rejectedを判断する（本Skillは自動昇格しない）。
