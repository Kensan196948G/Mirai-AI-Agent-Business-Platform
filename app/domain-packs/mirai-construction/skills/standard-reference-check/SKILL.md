---
name: standard-reference-check
description: "承認済み出典のうち基準・指針・技術資料の版（発行日・版・有効期限・発行元）を確認し、古い版と新しい版の混在を検出する。基準本文は判断に使わない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

根拠基準の版・発行元を保持し（D-019）、旧版と新版を混同しない（G-016 / X-015）。

## 起動条件

- 専門 Agent が基準・指針を根拠にする前。

## 使わない条件

- 基準の適用可否そのものの判断（専門技術者が行う）。

## 必要入力

- `query`、`standard_source_types`（Agent 契約の params で固定。既定 standard / technology_catalog）

## 手順

1. 承認済み出典を検索し、published_at / version / effective_to / license_or_permission を references に列挙する
2. 同じタイトルで版が複数ある、または有効期限切れ間近のものを issues に列挙する
3. 基準（source_type=standard）が 1 件も無ければ unknowns に「社内基準は未登録」を明示する

## 許可されたTool

- `knowledge.search-approved`
- `artifact.write-draft`（草案の保存。人手確認固定）

## 保留・失敗条件

- なし。

## 成果物形式

`{ references:[{source_record_id, title, version, published_at, effective_to}], issues, unknowns }`

## 根拠

source_records の列の転記。

## 専門家確認事項

適用する基準の版は技術責任者が確定する。
