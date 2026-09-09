-- 015: Agent → Skill 束縛ごとの固定パラメータ（第 2 段: 組織責務 Agent が共通 Skill を再利用するため）。additive のみ。
ALTER TABLE agent_skill_bindings ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;
