#!/usr/bin/env bash
# Daily encrypted MySQL backup for OneShopLab.
#
#   mysqldump --single-transaction  →  zstd  →  gpg (AES-256, symmetric)
#   → local copy (30 d) → R2 `backups/mysql/` (7 dailies + 4 weeklies, quota-friendly)
#
# Runs from cron as `ubuntu` (needs passwordless `sudo mysqldump`, like the
# other backups on this box). On any failure an alert is posted to Discord
# #staff-logs through the bot API; success is logged only.
#
# Secrets: the passphrase lives in $KEY_FILE (0600, NOT in the repo). Lose it
# and every backup is unreadable — a copy belongs in the password manager.
#
# Usage: scripts/backup/backup-mysql.sh            (cron)
#        scripts/backup/backup-mysql.sh --no-upload (local only, for tests)
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
KEY_FILE="${ONESHOPLAB_BACKUP_KEY_FILE:-/home/ubuntu/.oneshoplab-backup.key}"
BACKUP_DIR="${ONESHOPLAB_BACKUP_DIR:-/home/ubuntu/backups/oneshoplab-mysql}"
# Disk is cheap here (hundreds of GB free), R2 is not (free tier): 30 local
# dailies, but R2 keeps 7 dailies + 4 weeklies ≈ 11 files (see r2-backup.ts prune).
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
R2_RETENTION_DAYS="${R2_RETENTION_DAYS:-7}"
R2_PREFIX="backups/mysql"
UPLOAD=1
[[ "${1:-}" == "--no-upload" ]] && UPLOAD=0

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

alert() {
  # Best effort: never let the alert itself fail the script.
  local msg="$1"
  local url key
  url=$(grep -E '^DISCORD_BOT_API_URL=' "$ENV_FILE" | cut -d= -f2- || true)
  key=$(grep -E '^DISCORD_BOT_API_KEY=' "$ENV_FILE" | cut -d= -f2- || true)
  [[ -z "$url" || -z "$key" ]] && return 0
  curl -sS -m 10 -X POST "$url/api/messages" \
    -H "content-type: application/json" -H "x-api-key: $key" \
    --data "$(printf '{"channel":"staff-logs","content":%s}' "$(printf '%s' "$msg" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.stringify(String(d))))')")" \
    >/dev/null 2>&1 || true
}

on_error() {
  local line="$1"
  log "FAILED at line $line"
  alert "🚨 **Sauvegarde MySQL OneShopLab ÉCHOUÉE** (ligne $line) — voir $BACKUP_DIR/backup.log sur le serveur."
  exit 1
}
trap 'on_error $LINENO' ERR

# --- preflight ---------------------------------------------------------------
[[ -r "$KEY_FILE" ]] || { log "missing key file $KEY_FILE"; false; }
[[ "$(stat -c %a "$KEY_FILE")" == "600" ]] || { log "key file must be mode 0600"; false; }
DB_NAME=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')
[[ -n "$DB_NAME" ]] || { log "cannot read DB name from DATABASE_URL"; false; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP=$(date -u +%Y-%m-%d_%H%M)
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.zst.gpg"
TMP="$OUT.part"

# --- dump → compress → encrypt (streamed, nothing plaintext touches disk) ----
log "dumping $DB_NAME → $OUT"
sudo -n mysqldump --single-transaction --quick --routines --triggers --events \
  --set-gtid-purged=OFF --column-statistics=0 "$DB_NAME" \
  | zstd -T0 -3 -q \
  | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
        --passphrase-file "$KEY_FILE" --output "$TMP"
mv "$TMP" "$OUT"
SIZE=$(stat -c %s "$OUT")
[[ "$SIZE" -gt 100000 ]] || { log "backup suspiciously small ($SIZE bytes)"; false; }
log "done: $(numfmt --to=iec "$SIZE")"

# --- sanity: the file decrypts and decompresses back to SQL ------------------
# Only the first 4 KiB are needed; `head` closing the pipe early makes gpg
# exit on SIGPIPE, which pipefail would count as a failure — hence the subshell.
HEAD=$(set +o pipefail; gpg --batch --quiet --decrypt --passphrase-file "$KEY_FILE" "$OUT" 2>/dev/null \
  | zstd -d -q 2>/dev/null | head -c 4096)
grep -q -- '-- MySQL dump' <<<"$HEAD" \
  || { log "verification failed: decrypted stream is not a MySQL dump"; false; }
log "verified decrypt+decompress"

# --- local rotation ----------------------------------------------------------
DELETED=$(find "$BACKUP_DIR" -name "*.sql.zst.gpg" -mtime +"$LOCAL_RETENTION_DAYS" -delete -print | wc -l)
log "local rotation: $DELETED file(s) older than ${LOCAL_RETENTION_DAYS}d removed"

# --- offsite: R2 -------------------------------------------------------------
if [[ "$UPLOAD" == 1 ]]; then
  cd "$APP_DIR"
  pnpm --silent exec tsx scripts/backup/r2-backup.ts upload "$OUT" "$R2_PREFIX/$(basename "$OUT")"
  pnpm --silent exec tsx scripts/backup/r2-backup.ts prune "$R2_PREFIX/" "$R2_RETENTION_DAYS"
  log "uploaded to r2://$R2_PREFIX/$(basename "$OUT")"
fi

log "OK"
