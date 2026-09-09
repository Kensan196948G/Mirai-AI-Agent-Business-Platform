-- Worker の生存監視（A-5）。Worker はアイドル時もポーリングごとに last_seen_at を更新する。
-- /api/health と watchdog.mjs がこれを参照し、Worker 停止・キュー滞留を検知する。
CREATE TABLE worker_heartbeats (
  worker_id     TEXT PRIMARY KEY,
  hostname      TEXT NOT NULL,
  pid           INTEGER NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  runs_claimed  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_worker_heartbeats_last_seen ON worker_heartbeats(last_seen_at);
