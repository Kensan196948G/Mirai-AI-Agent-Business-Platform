-- 013: 成果物レビューの項目別チェック（G-36）。不明点・仮定などを 1 つずつ「確認済み」にできる。additive のみ。
CREATE TABLE IF NOT EXISTS artifact_checks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id  BIGINT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('unknown','assumption','finding','flag')),
  item_hash    TEXT NOT NULL,                      -- 項目テキストの SHA-256（本文が同じ項目を同一視する）
  item_text    TEXT NOT NULL,
  checked      BOOLEAN NOT NULL DEFAULT false,
  note         TEXT,
  checked_by   BIGINT REFERENCES users(id),
  checked_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, item_kind, item_hash)
);
