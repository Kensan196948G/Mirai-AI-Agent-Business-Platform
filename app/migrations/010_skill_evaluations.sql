-- 010: Skill 評価ランナーの結果（C-16）。additive のみ。
CREATE TABLE IF NOT EXISTS skill_evaluations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id         TEXT NOT NULL,                      -- 1 回の実行（複数 Skill・ケース）をまとめる ID
  skill_id         TEXT NOT NULL,
  version          TEXT NOT NULL,
  content_hash     TEXT NOT NULL,                      -- 評価した Skill 定義の内容ハッシュ（改訂前後の比較キー）
  skill_version_id BIGINT REFERENCES skill_versions(id),
  mode             TEXT NOT NULL CHECK (mode IN ('offline','live')),  -- offline: LLM をスタブ / live: 実 LLM
  case_id          TEXT NOT NULL,
  passed           BOOLEAN NOT NULL,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb, -- 期待値ごとの判定、出力の要約、エラー
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(10,4) NOT NULL DEFAULT 0,
  evaluated_by     BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_evaluations_skill ON skill_evaluations(skill_id, version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_evaluations_batch ON skill_evaluations(batch_id);
