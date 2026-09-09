-- 009: 成果物の差分・履歴・レビュー後の版固定（C-15）。additive のみ。

ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS content_hash TEXT;                 -- 正規化した content の SHA-256
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS input_hash TEXT;                   -- Run の input_json の SHA-256（同じ相談の再実行を系譜で結ぶ）
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS previous_artifact_id BIGINT REFERENCES artifacts(id); -- 同じ Agent・種別・入力の直前の成果物
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS lineage_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS reviewed_content_hash TEXT;        -- レビュー時に固定した content_hash（以後の改変を検出する）
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_artifacts_lineage ON artifacts(kind, input_hash, id);

-- 同一 Run 内で草案が書き直された履歴（Step 再試行等）。現在の内容は artifacts.content、過去の内容はここ
CREATE TABLE IF NOT EXISTS artifact_revisions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id   BIGINT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, revision)
);

-- 再実行の系譜
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS rerun_of_run_id BIGINT REFERENCES agent_runs(id);
