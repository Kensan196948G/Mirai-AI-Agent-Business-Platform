-- 014: 司令塔（CTO Orchestrator）。利用者要求 → 計画（Agent 選択・順序・理由）→ 複数 Agent Run の実行 → 統合。additive のみ。

CREATE TABLE IF NOT EXISTS orchestrations (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  orchestration_code TEXT NOT NULL UNIQUE,                -- 例: 'ORC-1001'
  requested_by      BIGINT NOT NULL REFERENCES users(id),
  project_id        BIGINT REFERENCES projects(id),
  request_text      TEXT NOT NULL,
  intent            TEXT,
  risk              TEXT,                                  -- R0〜R5（計画時の推定。人間の最終判断を置き換えない）
  plan_source       TEXT NOT NULL DEFAULT 'scripted' CHECK (plan_source IN ('llm','scripted')),
  plan_json         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 選択理由・順序・却下した候補と理由
  status            TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','waiting_approval','completed','partial','failed','cancelled','blocked')),
  budget_usd        NUMERIC(10,4) NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(10,4) NOT NULL DEFAULT 0,
  final_artifact_id BIGINT REFERENCES artifacts(id),
  error_message     TEXT,
  cancel_requested  BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orchestrations_status ON orchestrations(status);

CREATE TABLE IF NOT EXISTS orchestration_steps (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  orchestration_id  BIGINT NOT NULL REFERENCES orchestrations(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  agent_id          TEXT NOT NULL,
  layer             TEXT NOT NULL DEFAULT 'organization',  -- organization / civil_expert / cross_review
  depends_on        INTEGER[] NOT NULL DEFAULT '{}',       -- 先行 step の seq
  input_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason            TEXT,                                  -- この Agent を選んだ理由（監査用）
  run_id            BIGINT REFERENCES agent_runs(id),
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','blocked','running','waiting_approval','completed','failed','cancelled','skipped')),
  error_message     TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  UNIQUE (orchestration_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_orchestration_steps_orch ON orchestration_steps(orchestration_id);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS orchestration_id BIGINT REFERENCES orchestrations(id);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS orchestration_step_id BIGINT REFERENCES orchestration_steps(id);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS orchestration_id BIGINT REFERENCES orchestrations(id);
