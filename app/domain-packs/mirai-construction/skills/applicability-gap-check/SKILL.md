---
name: applicability-gap-check
description: 承認済み技術資料と案件条件を照合し、適用候補、不足条件、要専門家確認事項を根拠付きで整理する。技術選定の事前検討に用い、施工可否の最終承認は行わない。
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

`technology-catalog-search`が返した候補技術それぞれについて、確認できた適用条件と、
まだ確認できていない不足情報を分離して整理する。

## 起動条件

- 前Stepの`candidates`が1件以上ある。

## 使わない条件

- `candidates`が0件の場合はこのStepをスキップし、`unknowns`をそのまま次Stepへ引き継ぐ。

## 必要入力

- `candidates`（前Stepの出力）
- `query`（利用者の相談内容）

## 手順

1. 各候補の`summary`（`marketing_overview`等の根拠種別）だけを根拠として、
   案件条件との一致点・不明点をLLMで構造化整理する（`provider-adapter`の構造化出力機能を使う）。
2. 現場条件・設計限界・歩掛・停止基準・保証性能など、`source_records`の記載範囲を超える推測は
   `assumptions`または`unknowns`に分離し、`gaps.confirmed`には入れない。
3. 出力は`evidence-validator`により、引用した`source_record_id`が実在し承認済みであることを検証する。

## 許可されたTool

- （Tool呼び出しなし。構造化LLM出力のみ）

## 保留・失敗条件

- 引用検証に失敗した候補は`unknowns`へ差し戻し、`gaps`から除外する。
- LLM出力がJSON Schemaを満たさない場合は最大1回リトライし、それでも失敗すれば当該候補を`unknowns`とする。

## 成果物形式

`{ gaps: [{source_record_id, confirmed: string[], missing: string[]}], unknowns: string[], assumptions: string[] }`

## 根拠

各`gaps`エントリは`source_record_id`に紐づく。根拠なき技術的主張（性能値・適用限界の断定等）は生成しない。

## 専門家確認事項

`missing`に列挙された不足条件は、必ず技術専門家の確認を要する事項として次Stepへ引き継ぐ。
