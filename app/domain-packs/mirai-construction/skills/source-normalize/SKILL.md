---
name: source-normalize
description: "許可された公開資料・合成データを正規化し、個人情報・位置情報・社外秘等の除外対象を検査して隔離する。取り込み段階でのみ使用し、検索・比較用の実行には使わない。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

新規に取り込む資料（公開資料テキスト、合成Fixture）から、ナビゲーション・広告等の非本文要素を除去し、
表記ゆれ・日付・単位を整理したうえで、除外対象（個人情報・位置情報・社外秘・秘密鍵・認証情報）を検査する。

## 起動条件

- 運用者が新しい`source_records`候補を取り込む時（Agent Run外の、データ整備バッチとして実行する）。

## 使わない条件

- 通常のAgent Run（技術検索・比較等）からは呼び出さない。取り込み専用。

## 必要入力

- `raw_text`（string）：取り込み元の生テキスト
- `source_type`（string）

## 手順

1. HTML等のナビゲーション・広告要素を除去する。
2. 表記ゆれ（全角/半角、日付形式、単位）を整理する。
3. 個人情報・位置情報・社外秘・秘密鍵・認証情報らしきパターンを検査する。検出した場合は
   `quarantined: true`として結果を返し、`source_records.status='quarantined'`扱いにする
   （このSkill自身はDBへ書き込まない。判定結果を返すのみ）。

## 許可されたTool

- （Tool呼び出しなし。ローカル処理のみ）

## 保留・失敗条件

- 除外対象の疑いがある場合は必ず`quarantined: true`とし、人間が確認するまで検索対象に含めない。

## 成果物形式

`{ normalized_text: string, quarantined: boolean, quarantine_reasons: string[] }`

## 根拠

該当なし（本Skillは根拠生成ではなく前処理）。

## 専門家確認事項

`quarantined: true`となった資料は、正式に登録する前に必ず人間が内容を確認する。
