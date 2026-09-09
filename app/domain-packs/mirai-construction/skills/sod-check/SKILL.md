---
name: sod-check
description: "承認申請と監査ログから職務分離（SoD）の観点で確認事項を抽出する（申請者本人の判定、Administrator の代理承認、未検証の正式承認参照）。"
metadata:
  version: "1.0.0"
  domain: "mirai-construction"
---

## 目的

ガバナンス・コンプライアンス向けの SoD チェック草案。

## 起動条件

- 承認運用の健全性を確認するとき。

## 使わない条件

- 承認の判定そのものを求められたとき。

## 必要入力

- `query`、`approval_id`（任意）

## 手順

1. approval_requests / approval_steps / audit_log を読み取り専用で照合する
2. 自己承認の試行（403 記録）、Administrator 代理承認、未検証の正式承認参照を findings に列挙する
3. 草案を保存する

## 許可されたTool

- `artifact.write-draft`

## 保留・失敗条件

- 該当なしは findings ゼロで正常。

## 成果物形式

`{ findings, checks:[{name, count}], unknowns, requires_human_review: true, artifact_id, artifact_code }`

## 根拠

DB の実データのみ。

## 専門家確認事項

是正の要否はコンプライアンス委員会・監査役が判断する。
