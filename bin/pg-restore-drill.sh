#!/usr/bin/env bash
# リストア訓練（A-6）: 最新のバックアップを使い捨て DB（mira_agent_os_restore_drill）へ復元し、
# 主要テーブルの件数を確認してから DROP する。本番・MVP DB には一切書き込まない。
# 実行には postgres ロールでの CREATE/DROP DATABASE が必要（sudo -u postgres）。
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/home/kensan/backups/mira-agent-os}"
DRILL_DB="mira_agent_os_restore_drill"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"  # pg-backup.sh と同じ major を使う
DB_NAME="${1:-mira_agent_os}"
# タイムスタンプ部分だけに一致させる（mira_agent_os_ が mira_agent_os_mvp_ にも前方一致するため）
latest="$(ls -1t "$BACKUP_DIR/${DB_NAME}_"[0-9]*.dump 2>/dev/null | head -1)"
[ -n "$latest" ] || { echo "バックアップが見つかりません: $BACKUP_DIR/${DB_NAME}_<日時>.dump" >&2; exit 1; }
echo "=== 対象バックアップ: $latest ==="
# 途中で失敗しても使い捨て DB を残さない
trap 'sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DRILL_DB;" >/dev/null 2>&1 || true' EXIT
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DRILL_DB;" -c "CREATE DATABASE $DRILL_DB;"
# dump は 0600（所有者のみ）なので postgres ユーザーへは stdin 経由で渡す（ファイル権限を緩めない）
sudo -u postgres "$PG_BIN/pg_restore" --no-owner --no-privileges --dbname="$DRILL_DB" < "$latest"
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
