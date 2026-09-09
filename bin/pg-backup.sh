#!/usr/bin/env bash
# Mirai AgentOS の本番/MVP DB を pg_dump（custom 形式）でバックアップする（A-6）。
# 接続情報は app/.env / app/.env.mvp の DATABASE_URL を使う（値は出力しない）。
# 保存先: $BACKUP_DIR（既定 /home/kensan/backups/mira-agent-os）、保持 $RETENTION_DAYS 日（既定 14）。
set -euo pipefail
APP="/home/kensan/Projects/Mirai-DX-Project/Mirai-AI-Agent-Business-Platform/app"
BACKUP_DIR="${BACKUP_DIR:-/home/kensan/backups/mira-agent-os}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
for envfile in .env .env.mvp; do
  url="$(sed -n 's/^DATABASE_URL=//p' "$APP/$envfile" | tr -d '"' | tr -d "'")"
  [ -n "$url" ] || { echo "DATABASE_URL が見つかりません: $envfile" >&2; exit 1; }
  db="${url##*/}"; db="${db%%\?*}"
  out="$BACKUP_DIR/${db}_${STAMP}.dump"
  pg_dump --format=custom --no-owner --no-privileges --dbname="$url" --file="$out"
  chmod 600 "$out"
  echo "backup: $db -> $out ($(du -h "$out" | cut -f1))"
done
find "$BACKUP_DIR" -name '*.dump' -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/retention削除: /' || true
echo "完了: $(ls -1 "$BACKUP_DIR"/*.dump 2>/dev/null | wc -l) 世代を保持"
