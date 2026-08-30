#!/usr/bin/env bash
# Idempotent production deploy for OneShopLab (single OVH box, PM2).
#
#   scripts/deploy.sh            # pull main, install, migrate, build, restart
#   scripts/deploy.sh --no-pull  # deploy the working tree as-is
#
# Every step is a gate: the script stops at the first failure and NEVER
# restarts PM2 unless a fresh BUILD_ID exists — "Compiled successfully"
# followed by a typecheck failure used to leave the site in 502.
set -euo pipefail

# OneShopLab runs on its own Node 22 LTS (/opt/node22), not the shared system
# node — see ecosystem.config.cjs. Build with the same runtime we serve with.
NODE_HOME="${ONESHOPLAB_NODE_HOME:-/opt/node22}"
[[ -x "$NODE_HOME/bin/node" ]] || { echo "missing $NODE_HOME/bin/node"; exit 1; }
export PATH="$NODE_HOME/bin:$PATH"
cd "$(dirname "$0")/.."

PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0
log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

if [[ $PULL -eq 1 ]]; then
  log "git pull --ff-only"
  git pull --ff-only
fi

log "install (frozen lockfile)"
pnpm install --frozen-lockfile

log "quality gates: lint · typecheck · i18n · audit(critical)"
pnpm lint
pnpm typecheck
pnpm i18n:check
pnpm audit:prod

log "database migrations"
pnpm db:migrate

log "build"
rm -f .next/BUILD_ID
pnpm build
if [[ ! -s .next/BUILD_ID ]]; then
  echo "✗ build produced no BUILD_ID — NOT restarting (site keeps the previous build)" >&2
  exit 1
fi
echo "BUILD_ID=$(cat .next/BUILD_ID)"

log "restart web + worker"
# startOrRestart re-reads ecosystem.config.cjs (interpreter, env) — a plain
# `pm2 restart` would keep whatever interpreter the process was started with.
pm2 startOrRestart ecosystem.config.cjs --only oneshoplab-web,oneshoplab-worker --update-env >/dev/null
sleep 6

log "health check"
for path in /fr /fr/pricing /fr/audit; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://oneshoplab.com${path}")
  printf '  %-14s %s\n' "$path" "$code"
  [[ "$code" == "200" ]] || { echo "✗ ${path} returned ${code}" >&2; exit 1; }
done
pm2 list | grep -E 'oneshoplab-(web|worker)' | awk -F'│' '{print "  " $3 $10}'
echo "✓ deployed $(git rev-parse --short HEAD)"
