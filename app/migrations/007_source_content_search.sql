-- 007: 出典の本文保存と検索改善（B-8〜B-12）
-- additive のみ。既存行は content_text='' / attributes='{}' のまま動作する。

-- 本文（正規化済みテキスト）・分類・構造化属性・取り込み者
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS category TEXT;                          -- 例: 港湾・海上 / 陸上工事
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb; -- 例: {"completed_year":2015,"prefecture":"千葉県","netis":"QSK-230004-A"}
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS ingested_by BIGINT REFERENCES users(id);
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS review_note TEXT;

-- 同じ URL の版管理: (canonical_url, version) は一意
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_records_url_version
  ON source_records(canonical_url, version) WHERE canonical_url IS NOT NULL;

-- 部分一致検索の高速化（pg_trgm は trusted extension のため DB 所有者ロールで作成できる）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_source_records_title_trgm   ON source_records USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_source_records_summary_trgm ON source_records USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_source_records_content_trgm ON source_records USING gin (content_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_source_records_type_status  ON source_records(source_type, status);
