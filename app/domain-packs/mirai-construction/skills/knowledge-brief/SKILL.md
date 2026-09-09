---
name: knowledge-brief
description: "承認済み出典（技術紹介・施工実績・基準等）を横断検索し、出典付きの要約（brief）を作る。断定せず、無ければ「該当なし」と返す。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

相談文に関係する承認済み出典を集め、事実（出典のタイトル・要約）と根拠 ID を一覧にする。複数 Agent（営業・施工・技術・支店・社外 DX）が共用する。

## 起動条件

- 組織責務 Agent の最初の Step として、相談文に関係する承認済み資料を集めるとき。

## 使わない条件

- 出典が承認されていない資料を対象にするとき（取り込み→承認を先に行う）。

## 必要入力

- `query`（相談文）、`source_types`（省略時は全種別）、`classification`（`public_only` で公開資料に限定）

## 手順

1. `knowledge.search-approved` を source_type ごとに呼び、承認済み・有効期限内の出典を集める
2. 見つかった出典のタイトル・要約を事実として列挙し、`sources` に ID を残す
3. 1 件も無ければ `unknowns` に「該当する承認済み出典が見つかりません」を記録して棄権する

## 許可されたTool

- `knowledge.search-approved`
- `artifact.write-draft`

## 保留・失敗条件

- 出典ゼロは失敗ではなく棄権（unknowns）。

## 成果物形式

`{ candidates, findings, sources, unknowns, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

事実は出典のタイトル・要約の転記のみで、新たな主張を生成しない。

## 専門家確認事項

要約は公開資料の範囲であり、施工条件の根拠としては専門家が原典を確認する。
