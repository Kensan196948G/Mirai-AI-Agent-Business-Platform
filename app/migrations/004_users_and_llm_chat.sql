-- ユーザーCRUD（無効化＝ソフトデリート）と、AI相談への実LLM（DeepSeek）接続に伴う
-- コスト記録・月次予算判定のための拡張。
--
-- 実LLM呼び出しは環境変数 LLM_PROVIDER / LLM_API_KEY が設定されている場合のみ行われる。
-- 未設定であれば従来どおりルールベース応答（chatScenarios.js）のみで動作し続ける。

-- ---------------------------------------------------------------------------
-- users: 無効化フラグ（物理削除はしない。projects.owner_id 等の参照整合性を壊さないため）
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- chat_messages: 実LLM応答のコスト記録（AIロールのメッセージのみ埋まる）
-- provider が NULL のままの行 = ルールベース応答（フォールバックまたは未接続時）
-- ---------------------------------------------------------------------------
ALTER TABLE chat_messages ADD COLUMN provider TEXT;
ALTER TABLE chat_messages ADD COLUMN tokens_in INTEGER;
ALTER TABLE chat_messages ADD COLUMN tokens_out INTEGER;
ALTER TABLE chat_messages ADD COLUMN cost NUMERIC(10,4);

-- 月次コスト集計（当月の SUM(cost)）のための索引
CREATE INDEX chat_messages_created_at_idx ON chat_messages (created_at);
