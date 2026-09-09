-- 016: 技術リスク T3 以上の専門技術者レビュー（第 3 段）。additive のみ。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS technical_risk_class TEXT;          -- Run 開始時の Agent 契約の T1〜T6
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS expert_review_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS expert_review_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS ai_completion_prohibited BOOLEAN NOT NULL DEFAULT false;  -- T5/T6: AI 単独で完了できない
