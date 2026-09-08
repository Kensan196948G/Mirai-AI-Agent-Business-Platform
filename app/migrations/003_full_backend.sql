-- Mirai AgentOS 本格実装 — 全11画面（Dashboard/Chat/Projects/Tasks/Approvals/Knowledge/
-- Audit/Integrations/Observability/Agents/Users）を実PostgreSQLへ接続するためのスキーマ拡張。
-- AIエージェント・外部API（Notion/Slack/Gmail/GitHub）の自動連携は行わない。
-- Integrations は接続状態を人が設定する管理テーブル、Chat は登録済みシナリオへの
-- ルールベース応答をDB永続化するのみ（agentos-data.js の SCENARIOS を移植）。

-- ---------------------------------------------------------------------------
-- users: 部署・最終ログイン
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN dept TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- projects: 9状態ワークフローへ拡張 + owner/risk/外部参照
-- ---------------------------------------------------------------------------
ALTER TABLE projects DROP CONSTRAINT projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (
  status IN ('idea','proposed','approved','active','staging','production','suspended','closed','archived')
);
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'idea';
ALTER TABLE projects ADD COLUMN owner_id BIGINT REFERENCES users(id);
ALTER TABLE projects ADD COLUMN risk TEXT NOT NULL DEFAULT 'R1' CHECK (risk IN ('R0','R1','R2','R3','R4','R5'));
ALTER TABLE projects ADD COLUMN repo TEXT;
ALTER TABLE projects ADD COLUMN notion_ref TEXT;
ALTER TABLE projects ADD COLUMN slack_ref TEXT;

-- 既存データ（旧3状態: pending_approval/approved/rejected）を新9状態へ移行する。
-- pending_approval は Gate 1（企画審査）待ちの意味だったため proposed に、
-- rejected は却下の終端状態として archived に寄せる。
UPDATE projects SET status = 'proposed' WHERE status = 'pending_approval';
UPDATE projects SET status = 'archived' WHERE status = 'rejected';

-- ---------------------------------------------------------------------------
-- project_kpis: Project 別 KPI（目標/現在値）
-- ---------------------------------------------------------------------------
CREATE TABLE project_kpis (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  target      NUMERIC NOT NULL,
  current     NUMERIC NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_kpis_project ON project_kpis(project_id);

-- ---------------------------------------------------------------------------
-- approval_requests: 種別・リスク・対象の明示 + 多段階承認
-- ---------------------------------------------------------------------------
ALTER TABLE approval_requests ADD COLUMN approval_code TEXT UNIQUE;
ALTER TABLE approval_requests ADD COLUMN type TEXT NOT NULL DEFAULT 'project_gate'
  CHECK (type IN ('project_gate','production_release','github_merge','budget'));
ALTER TABLE approval_requests ADD COLUMN risk TEXT NOT NULL DEFAULT 'R2' CHECK (risk IN ('R0','R1','R2','R3','R4','R5'));
ALTER TABLE approval_requests ADD COLUMN target TEXT NOT NULL DEFAULT '';
-- 承認確定時に projects.status へ反映する遷移先（Project の状態遷移に紐づく承認のみ設定）
ALTER TABLE approval_requests ADD COLUMN target_status TEXT
  CHECK (target_status IS NULL OR target_status IN ('idea','proposed','approved','active','staging','production','suspended','closed','archived'));

CREATE TABLE approval_steps (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_id       BIGINT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('Administrator','Developer','Reviewer','Approver','Knowledge Curator','Viewer')),
  assigned_user_id  BIGINT REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at        TIMESTAMPTZ,
  reason            TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_steps_approval ON approval_steps(approval_id);

-- ---------------------------------------------------------------------------
-- tasks / task_tool_calls: Agent Run 実行ログ
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_code             TEXT NOT NULL UNIQUE,
  project_id            BIGINT NOT NULL REFERENCES projects(id),
  title                 TEXT NOT NULL,
  agent_name            TEXT NOT NULL,
  provider              TEXT NOT NULL,
  model                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','running','blocked','review','completed','failed','cancelled')),
  tokens_in             BIGINT NOT NULL DEFAULT 0,
  tokens_out            BIGINT NOT NULL DEFAULT 0,
  cost                  NUMERIC NOT NULL DEFAULT 0,
  latency_ms            BIGINT NOT NULL DEFAULT 0,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_by_approval_id BIGINT REFERENCES approval_requests(id),
  error_message         TEXT,
  created_by            BIGINT NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE task_tool_calls (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  risk        TEXT NOT NULL CHECK (risk IN ('R0','R1','R2','R3','R4','R5')),
  decision    TEXT NOT NULL CHECK (decision IN ('PERMIT','APPROVAL_REQUIRED','DENY')),
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_task_tool_calls_task ON task_tool_calls(task_id);

-- ---------------------------------------------------------------------------
-- knowledge_candidates
-- ---------------------------------------------------------------------------
CREATE TABLE knowledge_candidates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kc_code         TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Lesson','ADR','Playbook','Standard','Raw')),
  project_id      BIGINT REFERENCES projects(id),
  score           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','promoted','rejected')),
  summary         TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT '',
  duplicate_note  TEXT,
  notion_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_knowledge_status ON knowledge_candidates(status);

-- ---------------------------------------------------------------------------
-- audit_log: actor種別の明示 + 軽量Hash Chain
-- ---------------------------------------------------------------------------
-- target_id（BIGINT）は integrations/model_router 等の非数値ID（例: 'notion'）を
-- 記録できないため NULL 許容にする。以後は resource_type/resource_id（TEXT）を正とする。
ALTER TABLE audit_log ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE audit_log ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','agent','service'));
ALTER TABLE audit_log ADD COLUMN actor_name TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN resource_type TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN resource_id TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '00000000';
ALTER TABLE audit_log ADD COLUMN hash TEXT;

-- ---------------------------------------------------------------------------
-- integrations: Notion/Slack/Gmail/GitHub の接続状態（管理者が手動更新）
-- ---------------------------------------------------------------------------
CREATE TABLE integrations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'attention' CHECK (status IN ('connected','attention','error')),
  last_sync_at TIMESTAMPTZ,
  detail      TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- agents_config / skills_registry / model_router: 設定テーブル（実行はしない）
-- ---------------------------------------------------------------------------
CREATE TABLE agents_config (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  duty      TEXT NOT NULL DEFAULT '',
  skills    TEXT NOT NULL DEFAULT '',
  model     TEXT NOT NULL DEFAULT '',
  enabled   BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE skills_registry (
  name        TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  owner_role  TEXT NOT NULL,
  risk        TEXT NOT NULL CHECK (risk IN ('R0','R1','R2','R3','R4','R5')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('approved','draft','deprecated')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_router (
  category   TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  -- WebUI の一部ロジック（実装モデルとReviewモデルの分離チェック等）が表示順に依存するため、
  -- カテゴリ名のアルファベット順ではなく明示的な並び順を保持する。
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- chat_conversations / chat_messages: AI相談（ルールベース応答、DB永続化のみ）
-- ---------------------------------------------------------------------------
CREATE TABLE chat_conversations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conversations_user ON chat_conversations(user_id);

CREATE TABLE chat_messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','ai')),
  text            TEXT NOT NULL,
  idea_json       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id);
