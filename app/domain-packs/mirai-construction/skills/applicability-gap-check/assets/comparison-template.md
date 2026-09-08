# 適用条件比較テンプレート

`applicability-gap-check` Skillが生成する `gaps` 配列を、人間レビュー用に整形する際の参考テンプレート。
実際の出力形式は `schemas/output.schema.json` を正とする（本ファイルは表示レイアウトの参考のみ）。

| 出典（source_record_id） | 確認できた適用条件（confirmed） | 未確認の不足条件（missing） |
|---|---|---|
| （例）1 | 公開概要に記載の一般的用途 | 現場固有の施工条件、性能値 |

- `confirmed` は出典の `summary` に明記された内容のみを転記する（推測・補完しない）。
- `missing` は技術専門家への確認事項として、次Step（`technology-comparison`）・人間レビューへ引き継ぐ。
