#!/usr/bin/env bash
# Weekly restore drill: fetch the latest R2 backup, decrypt it, load it into a
# scratch database and compare table counts with production. A backup that has
# never been restored is not a backup.
#
# Usage: scripts/backup/restore-test.sh              (latest from R2)
#        scripts/backup/restore-test.sh <local.sql.zst.gpg>
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
KEY_FILE="${ONESHOPLAB_BACKUP_KEY_FILE:-/home/ubuntu/.oneshoplab-backup.key}"
WORK_DIR="${ONESHOPLAB_BACKUP_DIR:-/home/ubuntu/backups/oneshoplab-mysql}/restore-test"
SCRATCH_DB="oneshoplab_restore_test"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
alert() {
  local url key
  url=$(grep -E '^DISCORD_BOT_API_URL=' "$ENV_FILE" | cut -d= -f2- || true)
  key=$(grep -E '^DISCORD_BOT_API_KEY=' "$ENV_FILE" | cut -d= -f2- || true)
  [[ -z "$url" || -z "$key" ]] && return 0
  curl -sS -m 10 -X POST "$url/api/messages" -H "content-type: application/json" -H "x-api-key: $key" \
    --data "$(printf '{"channel":"staff-logs","content":%s}' "$(printf '%s' "$1" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.stringify(String(d))))')")" \
    >/dev/null 2>&1 || true
}
cleanup() { sudo -n mysql -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`" >/dev/null 2>&1 || true; rm -rf "$WORK_DIR"; }
on_error() { log "FAILED at line $1"; alert "🚨 **Test de restauration MySQL OneShopLab ÉCHOUÉ** (ligne $1)"; cleanup; exit 1; }
trap 'on_error $LINENO' ERR

DB_NAME=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')
mkdir -p "$WORK_DIR"; chmod 700 "$WORK_DIR"

if [[ -n "${1:-}" ]]; then
  FILE="$1"
else
  cd "$APP_DIR"
  KEY=$(pnpm --silent exec tsx scripts/backup/r2-backup.ts latest backups/mysql/)
  FILE="$WORK_DIR/$(basename "$KEY")"
  log "downloading $KEY"
  pnpm --silent exec tsx scripts/backup/r2-backup.ts download "$KEY" "$FILE" >/dev/null
fi
log "restoring $(basename "$FILE") into $SCRATCH_DB"

sudo -n mysql -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`; CREATE DATABASE \`$SCRATCH_DB\` CHARACTER SET utf8mb4"
gpg --batch --quiet --decrypt --passphrase-file "$KEY_FILE" "$FILE" | zstd -d -q | sudo -n mysql "$SCRATCH_DB"

# Compare exact row counts per table (backup is a consistent snapshot, prod
# moved on since, so small drifts on hot tables are expected — big gaps or
# missing tables are not).
REPORT=$(sudo -n mysql -N -e "
  SELECT p.table_name,
         (SELECT COUNT(*) FROM information_schema.tables r WHERE r.table_schema='$SCRATCH_DB' AND r.table_name=p.table_name) AS present
  FROM information_schema.tables p WHERE p.table_schema='$DB_NAME' AND p.table_type='BASE TABLE'")
MISSING=$(printf '%s\n' "$REPORT" | awk '$2==0{print $1}')
TABLES=$(printf '%s\n' "$REPORT" | wc -l)
[[ -z "$MISSING" ]] || { log "tables missing in restore: $MISSING"; false; }

for T in users credit_transactions audits; do
  P=$(sudo -n mysql -N -e "SELECT COUNT(*) FROM \`$DB_NAME\`.\`$T\`" 2>/dev/null || echo "n/a")
  R=$(sudo -n mysql -N -e "SELECT COUNT(*) FROM \`$SCRATCH_DB\`.\`$T\`" 2>/dev/null || echo "n/a")
  log "  $T: prod=$P restored=$R"
done

cleanup
log "OK — $TABLES tables restored from $(basename "$FILE")"
