---
name: source-citation-verify
description: 成果物が引用するsource_recordのID・版・参照権限を検証する。存在しない・失効した・権限外の引用を検出し除去対象として報告する。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

成果物内の`sources`配列に列挙された`source_record_id`が、実在し、`status='approved'`であり、
呼び出し元Runの案件権限（`project_scope`）に合致することを検証する。

## 起動条件

- `evidence-backed-draft`等、根拠付き成果物を生成するSkillの直前・直後に呼び出す。

## 使わない条件

- `sources`が空の場合は検証をスキップし、空配列を返す。

## 必要入力

- `sources`（`[{source_record_id}]`）
- `project_id`（Runのスコープ）

## 手順

1. 各`source_record_id`について`source_records`テーブルを照会する。
2. `status != 'approved'`、または`classification='internal_project'`かつ`project_scope`がRunの
   `project_id`と一致しない場合は`invalid`として報告する。
3. 有効な引用のみ`valid`として返す。

## 許可されたTool

- `knowledge.search-approved`（IDによる単純参照のみ）

## 保留・失敗条件

- 全件が`invalid`でもエラーにはしない。呼び出し元Skillが`unknowns`へ振り替える。

## 成果物形式

`{ valid: integer[], invalid: [{source_record_id, reason}] }`

## 根拠

このSkill自体はDBの`status`/`classification`列を機械的に照合するのみで、新たな主張は生成しない。

## 専門家確認事項

`invalid`となった引用が多い成果物は、人間レビュー時に「根拠不足」として明示する。
