-- 011: 外部連携の実状態と、正式承認（desknet's NEO）参照の枠（D-20〜D-23 の基盤）。additive のみ。

-- 正式承認 SoR / 案件 SoR を Integrations に追加（接続状態は手動ではなく疎通確認で更新する）
INSERT INTO integrations (id, name, role, status, detail, note) VALUES
  ('neo', 'desknet''s NEO Workflow', '正式承認 SoR', 'attention', '未接続（環境変数未設定）', '承認番号の手入力は「未検証」のまま扱い、本番実行の許可にしない'),
  ('appsuite', 'AppSuite', '案件・Phase・KPI SoR', 'attention', '未接続（環境変数未設定）', '共通案件 ID（DX-YYYY-NNNN）で Run・成果物を対応付ける')
ON CONFLICT (id) DO NOTHING;

-- 正式承認の参照（NEO の承認番号）。verified になるのは NEO 連携で検証できた場合のみ
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS external_ref_status TEXT
  CHECK (external_ref_status IS NULL OR external_ref_status IN ('unverified','verified','rejected'));
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS external_ref_note TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS external_ref_updated_at TIMESTAMPTZ;
