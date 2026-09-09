-- 008: Run の承認拘束（waiting_approval）と一時停止・再開（C-13）。additive のみ。

-- Skill 契約の承認ゲート（execution.yaml の approval_gate を Registry 同期時にキャッシュ）
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS approval_gate JSONB;

-- Run 側: 承認待ち理由、紐づく承認申請、一時停止要求
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS waiting_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS approval_request_id BIGINT REFERENCES approval_requests(id);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pause_requested BOOLEAN NOT NULL DEFAULT false;

-- 承認申請側: Agent Run の Step に対する申請（案件に属さない Run もあるため project_id を任意化）
ALTER TABLE approval_requests ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_type_check
  CHECK (type IN ('project_gate','production_release','github_merge','budget','agent_run_step'));
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS agent_run_id BIGINT REFERENCES agent_runs(id);
-- 承認が拘束する対象と版（agent_version_id / skill_version_id / skill_content_hash / step_index / input_hash）
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS binding JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_approval_requests_agent_run ON approval_requests(agent_run_id);
