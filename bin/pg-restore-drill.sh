#!/usr/bin/env bash
# リストア訓練（A-6）: 最新のバックアップを使い捨て DB（mira_agent_os_restore_drill）へ復元し、
# 主要テーブルの件数を確認してから DROP する。本番・MVP DB には一切書き込まない。
# 実行には postgres ロールでの CREATE/DROP DATABASE が必要（sudo -u postgres）。
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/home/kensan/backups/mira-agent-os}"
DRILL_DB="mira_agent_os_restore_drill"
DB_NAME="${1:-mira_agent_os}"
latest="$(ls -1t "$BACKUP_DIR/${DB_NAME}_"*.dump 2>/dev/null | head -1)"
[ -n "$latest" ] || { echo "バックアップが見つかりません: $BACKUP_DIR/${DB_NAME}_*.dump" >&2; exit 1; }
echo "=== 対象バックアップ: $latest ==="
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DRILL_DB;" -c "CREATE DATABASE $DRILL_DB;"
sudo -u postgres pg_restore --no-owner --no-privileges --dbname="$DRILL_DB" "$latest"
echo "=== 復元後の件数 ==="
sudo -u postgres psql -At "$DRILL_DB" -c "
SELECT 'users', count(*) FROM users UNION ALL
SELECT 'projects', count(*) FROM projects UNION ALL
SELECT 'agent_runs', count(*) FROM agent_runs UNION ALL
SELECT 'artifacts', count(*) FROM artifacts UNION ALL
SELECT 'source_records', count(*) FROM source_records UNION ALL
SELECT 'audit_log', count(*) FROM audit_log UNION ALL
SELECT 'schema_migrations', count(*) FROM schema_migrations;" | sed 's/|/: /'
sudo -u postgres psql -q -c "DROP DATABASE $DRILL_DB;"
echo "=== 訓練完了（使い捨てDBは削除済み） ==="
