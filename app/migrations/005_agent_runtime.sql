-- Mirai Agent／Skill 共通実行基盤（P0）+ みらい建設 Domain Pack（P1）用スキーマ。
-- 設計判断は docs/decisions/ADR-001-agent-skill-runtime.md を参照。
--
-- P2/P3（港湾・地盤・維持管理等の業務拡張、専門システムとの外部連携）は本migrationの対象外。
-- effect_ledger は今回のP1（A0〜A1、外部書き込みなし）では未使用のスキーマのみ用意する。

-- ---------------------------------------------------------------------------
-- Registry: Agent版・Skill版・その関連（版を固定してRunする）
-- ---------------------------------------------------------------------------
CREATE TABLE agent_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id        TEXT NOT NULL,                 -- 例: 'technology-selection'（domain-packs内のディレクトリ名）
  version         TEXT NOT NULL,                 -- 例: '1.0.0'
  content_hash    TEXT NOT NULL,                 -- pack.yaml + agents/<id>.yaml の内容ハッシュ
  domain_pack     TEXT NOT NULL,                 -- 例: 'mirai-construction'
  owner_role      TEXT NOT NULL,                 -- 例: '技術'（責任者ロール。要件定義書のロールとは別軸）
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','deprecated')),
  definition_path TEXT NOT NULL,                 -- リポジトリ内の相対パス
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE TABLE skill_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  skill_id        TEXT NOT NULL,                 -- 例: 'technology-catalog-search'
  version         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,                 -- SKILL.md + execution.yaml + schemas の内容ハッシュ
  domain_pack     TEXT NOT NULL,
  owner_role      TEXT NOT NULL,
  risk            TEXT NOT NULL DEFAULT 'R1' CHECK (risk IN ('R0','R1','R2','R3','R4','R5')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','deprecated')),
  definition_path TEXT NOT NULL,
  allowed_tools   JSONB NOT NULL DEFAULT '[]',   -- execution.yaml の allowed_tools をキャッシュ
  approved_by     BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);

CREATE TABLE agent_skill_bindings (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_version_id  BIGINT NOT NULL REFERENCES agent_versions(id),
  skill_version_id  BIGINT NOT NULL REFERENCES skill_versions(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_version_id, skill_version_id)
);

-- ---------------------------------------------------------------------------
-- 出典・根拠（source_records）— 公開情報・合成Fixtureのみ。個人情報・位置情報を含めない。
-- ---------------------------------------------------------------------------
CREATE TABLE source_records (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_code         TEXT NOT NULL UNIQUE,       -- 例: 'SRC-0001'
  canonical_url       TEXT,
  title               TEXT NOT NULL,
  source_type         TEXT NOT NULL,              -- 例: 'company_website'
  evidence_type       TEXT NOT NULL,              -- 例: 'marketing_overview'（施工基準ではないことを明示）
  summary             TEXT NOT NULL DEFAULT '',
  published_at        DATE,
  fetched_at          TIMESTAMPTZ,
  effective_from      DATE,
  effective_to        DATE,
  content_hash        TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  reviewer_id         BIGINT REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  classification      TEXT NOT NULL DEFAULT 'public' CHECK (classification IN ('public','internal_project')),
  project_scope       BIGINT REFERENCES projects(id),
  license_or_permission TEXT,
  supersedes_id       BIGINT REFERENCES source_records(id),
  status              TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','superseded','quarantined')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_source_records_status ON source_records(status);

-- ---------------------------------------------------------------------------
-- Run（永続ジョブ）: Lease/Heartbeat/Checkpoint/Step/予算予約
-- ---------------------------------------------------------------------------
CREATE TABLE agent_runs (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_code            TEXT NOT NULL UNIQUE,       -- 例: 'RUN-0001'
  agent_id            TEXT NOT NULL,
  agent_version_id    BIGINT NOT NULL REFERENCES agent_versions(id),
  project_id          BIGINT REFERENCES projects(id),  -- 案件に紐付かないRunも許容（例: 一般的な技術調査）
  requested_by        BIGINT NOT NULL REFERENCES users(id),
  input_json          JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_approval','paused','completed','failed','cancelled')),
  current_step        INTEGER NOT NULL DEFAULT 0,
  max_steps           INTEGER NOT NULL DEFAULT 8,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts_per_step INTEGER NOT NULL DEFAULT 3,
  no_progress_count   INTEGER NOT NULL DEFAULT 0,
  lease_owner         TEXT,                       -- Worker識別子（プロセスID等）
  lease_expires_at    TIMESTAMPTZ,
  cancel_requested    BOOLEAN NOT NULL DEFAULT false,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_project ON agent_runs(project_id);

CREATE TABLE run_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES agent_runs(id),
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,                    -- 'step_started' | 'tool_call' | 'step_completed' | 'error' | 'cancelled' | 'waiting_approval'
  skill_id      TEXT,
  skill_version TEXT,
  tool_name     TEXT,
  status        TEXT,                             -- 'permit' | 'deny' | 'ok' | 'error'
  detail        JSONB NOT NULL DEFAULT '{}',
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cost          NUMERIC(10,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE TABLE budget_reservations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        BIGINT NOT NULL REFERENCES agent_runs(id),
  reserved_usd  NUMERIC(10,4) NOT NULL,
  spent_usd     NUMERIC(10,4) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','settled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at   TIMESTAMPTZ
);

-- 外部への副作用（Notion確定登録・Slack送信等、A2）の冪等台帳。
-- P1の3Agentは外部書き込みを行わないため今回は未使用（スキーマのみ、P2/P3向けBacklog）。
CREATE TABLE effect_ledger (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES agent_runs(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  effect_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','confirmed','unknown','failed')),
  detail          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 成果物（草案）と根拠引用
-- ---------------------------------------------------------------------------
CREATE TABLE artifacts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_code TEXT NOT NULL UNIQUE,             -- 例: 'ART-0001'
  run_id        BIGINT NOT NULL REFERENCES agent_runs(id),
  kind          TEXT NOT NULL,                    -- 例: 'technology_comparison_draft'
  title         TEXT NOT NULL,
  content       JSONB NOT NULL,                   -- findings/sources/unknowns/assumptions等の構造化出力
  review_state  TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','reviewed')),
  reviewed_by   BIGINT REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artifact_citations (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id       BIGINT NOT NULL REFERENCES artifacts(id),
  source_record_id  BIGINT NOT NULL REFERENCES source_records(id),
  locator           TEXT                          -- 該当箇所の説明（例: 'MC-Float Navi 概要ページ第2段落'）
);

-- ---------------------------------------------------------------------------
-- 既存テーブルへの参照列追加（Runtime管理レコードの識別。既存カラムは変更しない）
-- ---------------------------------------------------------------------------
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','runtime'));
ALTER TABLE tasks ADD COLUMN agent_run_id BIGINT REFERENCES agent_runs(id);

ALTER TABLE knowledge_candidates ADD COLUMN agent_run_id BIGINT REFERENCES agent_runs(id);
ALTER TABLE knowledge_candidates ADD COLUMN artifact_id BIGINT REFERENCES artifacts(id);
