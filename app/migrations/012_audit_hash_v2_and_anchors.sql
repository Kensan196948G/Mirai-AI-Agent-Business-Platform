-- 012: 監査ログの SHA-256 化（版付き）と日次アンカー（F-30）。additive のみ。旧ログは再署名しない。

-- 1 = 従来の 32bit 簡易ハッシュ（既存行）、2 = SHA-256（以後の新規行）
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash_version SMALLINT NOT NULL DEFAULT 1;

-- 日次アンカー: その時点までのチェーン末尾を固定し、外部（DB 外の追記専用ファイル）にも同じ値を書き出す
CREATE TABLE IF NOT EXISTS audit_anchors (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  last_audit_id  BIGINT NOT NULL,
  last_hash      TEXT NOT NULL,
  entry_count    BIGINT NOT NULL,
  anchor_hash    TEXT NOT NULL,                     -- sha256(prev_anchor_hash + last_audit_id + last_hash + entry_count)
  prev_anchor_hash TEXT,
  chain_ok       BOOLEAN NOT NULL,                  -- 直前アンカー以降のチェーン検証結果
  external_ref   TEXT,                              -- 外部保管先（ファイルパス等）。値そのものは外部にも同じ行が残る
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
