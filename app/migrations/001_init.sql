-- Mirai AgentOS MVP — 初期スキーマ
-- 対象 User Journey: 案件依頼登録（Idea）→ Project 昇格 → Gate 承認（Approve/Reject）
-- 要件定義書 FR-001, FR-003, FR-101, FR-102, FR-103 の最小垂直スライス。
-- Workflow Engine / Model Router / Notion・Slack・GitHub 連携等はスコープ外（設計書参照のみ）。

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  -- 要件定義書 03節のロール。MVP では Administrator のみ実運用、他は将来拡張用。
  role          TEXT NOT NULL CHECK (role IN ('Administrator','Developer','Reviewer','Approver','Knowledge Curator','Viewer')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE requests (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_code   TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  requester_id   BIGINT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','promoted','rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_code TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  request_id   BIGINT NOT NULL REFERENCES requests(id),
  -- pending_approval: Gate 1 待ち。approved/rejected: Gate 1 判定確定。
  status       TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected')),
  created_by   BIGINT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id),
  requested_by BIGINT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by   BIGINT REFERENCES users(id),
  decided_at   TIMESTAMPTZ,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FR-103 の Evidence 記録。承認・却下・作成等の全操作を残す（改ざん不可の代わりに INSERT のみで運用）。
CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   BIGINT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_requester ON requests(requester_id);
CREATE INDEX idx_projects_request ON projects(request_id);
CREATE INDEX idx_approval_requests_project ON approval_requests(project_id);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);
