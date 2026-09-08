-- ステートレス HMAC セッションは、Cookie を消すだけでは失効しない（トークン自体は有効期限まで有効）。
-- ログアウトを実効化するため、ユーザーごとの token_version を持ち、ログアウト時にインクリメントする。
-- 発行済みトークンは token_version を埋め込み、検証時に現在値と一致しないものは拒否する。
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
