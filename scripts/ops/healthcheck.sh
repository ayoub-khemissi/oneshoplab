#!/usr/bin/env bash
# Every 5 min from cron: is OneShopLab actually serving customers?
#   - GET /api/health (db + worker heartbeat)   → 200 expected
#   - GET /fr                                     → 200 expected
#   - pm2 web + worker online
#   - disk < 90 %
# One Discord alert per failing check (deduped in $STATE_FILE), one
# "recovered" message when it clears. Never exits non-zero (cron noise).
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env"
STATE_FILE="/home/ubuntu/.oneshoplab-healthcheck-alerts"
BASE_URL="${HEALTHCHECK_BASE_URL:-https://oneshoplab.com}"
touch "$STATE_FILE"

discord() {
  local url key
  url=$(grep -E '^DISCORD_BOT_API_URL=' "$ENV_FILE" | cut -d= -f2- || true)
  key=$(grep -E '^DISCORD_BOT_API_KEY=' "$ENV_FILE" | cut -d= -f2- || true)
  [[ -z "$url" || -z "$key" ]] && return 0
  curl -sS -m 10 -X POST "$url/api/messages" -H "content-type: application/json" -H "x-api-key: $key" \
    --data "$(printf '{"channel":"staff-logs","content":%s}' "$(printf '%s' "$1" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.stringify(String(d))))')")" \
    >/dev/null 2>&1 || true
}
fail() { # key, message
  if ! grep -qxF "$1" "$STATE_FILE"; then
    echo "$1" >> "$STATE_FILE"
    discord "🚨 **OneShopLab** — $2"
  fi
  echo "$(date -u +%FT%TZ) FAIL $1: $2"
}
pass() { # key
  if grep -qxF "$1" "$STATE_FILE"; then
    sed -i "/^$1\$/d" "$STATE_FILE"
    discord "✅ **OneShopLab** — $1 rétabli"
  fi
}

# --- app -------------------------------------------------------------------
BODY=$(curl -sS -m 15 -w '\n%{http_code}' "$BASE_URL/api/health" 2>/dev/null || echo -e "\n000")
CODE=${BODY##*$'\n'}; JSON=${BODY%$'\n'*}
if [[ "$CODE" == "200" ]]; then pass api-health; else fail api-health "/api/health → HTTP $CODE ${JSON:0:300}"; fi

CODE=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$BASE_URL/fr" 2>/dev/null || echo 000)
if [[ "$CODE" == "200" ]]; then pass home-page; else fail home-page "/fr → HTTP $CODE"; fi

# --- processes ---------------------------------------------------------------
for P in oneshoplab-web oneshoplab-worker; do
  ST=$(pm2 jlist 2>/dev/null | node -e 'const l=JSON.parse(require("fs").readFileSync(0));const p=l.find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"missing")' "$P")
  if [[ "$ST" == "online" ]]; then pass "pm2-$P"; else fail "pm2-$P" "pm2 $P est \`$ST\`"; fi
done

# --- disk --------------------------------------------------------------------
USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if (( USE < 90 )); then pass disk; else fail disk "disque / à ${USE} %"; fi
exit 0
