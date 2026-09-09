-- 017: 承認の期限・差戻し・理由必須（J-006〜J-010）。additive のみ。
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;          -- 期限（NULL は期限なし。新規申請は API/Runtime が既定 72 時間で設定）
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_status_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('pending','approved','rejected','returned','expired'));
ALTER TABLE approval_steps DROP CONSTRAINT IF EXISTS approval_steps_status_check;
ALTER TABLE approval_steps ADD CONSTRAINT approval_steps_status_check
  CHECK (status IN ('pending','approved','rejected','returned'));
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending_expires ON approval_requests(expires_at) WHERE status = 'pending';
