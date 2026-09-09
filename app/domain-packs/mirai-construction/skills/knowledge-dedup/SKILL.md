---
name: knowledge-dedup
description: "Knowledge候補間の重複候補を検出する。矛盾する記述を重複と混同しない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

新規Knowledge候補と、既存の`promoted`済みKnowledgeとの重複可能性を検出する。

## 起動条件

- `knowledge-quality-review`の後続Step。

## 使わない条件

- 比較対象の既存Knowledgeが無い場合はスキップする。

## 必要入力

- `knowledge_candidate_id`、`title`、`summary`

## 手順

1. `knowledge.search-promoted`で既存の昇格済みKnowledgeからタイトル・要約の類似候補を検索する。
2. 内容が一致・包含関係にあるものは`duplicates`、矛盾する記述は`conflicts`に分けて報告する
   （矛盾を重複として扱わない）。

## 許可されたTool

- `knowledge.search-promoted`

## 保留・失敗条件

- 判定が難しい場合は`unknowns`に記録する。

## 成果物形式

`{ knowledge_candidate_id, duplicates: integer[], conflicts: [{knowledge_id, reason}], unknowns: string[] }`

## 根拠

既存Knowledgeの`id`を参照するのみ。

## 専門家確認事項

`conflicts`はKnowledge Curatorが内容の正誤を判断する。
