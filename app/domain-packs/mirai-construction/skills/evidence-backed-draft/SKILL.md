---
name: evidence-backed-draft
description: それまでのStep出力から、根拠付きの最終草案（Artifact）を作成し保存する。人間レビューを前提とした草案であり、正式な成果物ではない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

Runの最終Stepとして、`findings`・`sources`・`unknowns`・`assumptions`・`requires_human_review`を
含む構造化成果物を`artifacts`テーブルへ`review_state=draft`で保存する。

## 起動条件

- 前段Stepの出力（比較表・不足条件等）が揃っている。

## 使わない条件

- 前段Stepが1件も成果を出していない場合（すべて`unknowns`のみ）は、Runを`failed`ではなく
  「情報不足のため草案化を保留」した`artifacts`（`findings`が空、`requires_human_review=true`）として保存する。

## 必要入力

- Run全体のこれまでの出力（候補・比較表・不足情報・仮定）

## 手順

1. `findings`（確認できた事実）、`sources`（引用source_record_id一覧）、`unknowns`（不明点）、
   `assumptions`（仮定）を1つの構造化オブジェクトへ統合する。
2. `evidence-validator`で全`sources`が実在・承認済みであることを検証する。検証に失敗した引用は除去し、
   該当箇所を`unknowns`へ移す。
3. `artifact.write-draft` Toolで`artifacts`テーブルへ保存する（`review_state`は常に`draft`固定）。
4. `agent_version`・使用した`skill_versions`一覧を成果物のメタデータに含める。

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 引用検証がすべて失敗した場合でも、Runを失敗させず「根拠なし」の草案として保存し人間レビューへ回す
  （`on_missing_evidence: abstain`）。

## 成果物形式

`{ findings: string[], sources: [{source_record_id, locator}], unknowns: string[], assumptions: string[],
   requires_human_review: true, agent_version: string, skill_versions: object }`

## 根拠

このSkill自身は新しい技術的主張を作らず、前Stepの構造化出力を集約・検証するのみ。

## 専門家確認事項

`requires_human_review`は常に`true`固定。Artifactは`review_state=draft`のまま保存され、
昇格・正式採用の判断は人間（技術専門家・Knowledge Curator）に委ねる。
