#!/usr/bin/env bash
# Deploy the staging copy at staging.oneshoplab.com (/home/ubuntu/oneshoplab/staging).
#
#   scripts/deploy-staging.sh            # fetch + hard-reset to origin/main, then build
#   scripts/deploy-staging.sh <ref>      # same, but onto any branch/tag/sha
#   scripts/deploy-staging.sh --no-pull  # deploy the staging working tree as-is
#
# Deliberately different from the production script on two points:
#   * it resets rather than fast-forwards — staging is a scratch copy, and a
#     dirty tree there must never be a reason a test deploy fails;
#   * it skips the gates. Staging is where you go BECAUSE something doesn't
#     pass yet. Production keeps its gates.
# The BUILD_ID check stays: a failed build must not restart the app.
set -euo pipefail

NODE_HOME="${ONESHOPLAB_NODE_HOME:-/opt/node22}"
[[ -x "$NODE_HOME/bin/node" ]] || { echo "missing $NODE_HOME/bin/node"; exit 1; }
export PATH="$NODE_HOME/bin:$PATH"

STAGING_DIR="${ONESHOPLAB_STAGING_DIR:-/home/ubuntu/oneshoplab/staging}"
[[ -f "$STAGING_DIR/ecosystem.config.cjs" ]] || { echo "no staging checkout at $STAGING_DIR"; exit 1; }
cd "$STAGING_DIR"

# .env is per-environment and untracked; a reset must never be able to eat it.
[[ -s .env ]] || { echo "✗ $STAGING_DIR/.env is missing or empty — refusing"; exit 1; }
grep -q '^APP_ENV=staging' .env || { echo "✗ .env is not a staging env (APP_ENV≠staging) — refusing"; exit 1; }

REF="${1:-origin/main}"
log() { printf '\n\033[1;35m▶ [staging] %s\033[0m\n' "$*"; }

if [[ "$REF" != "--no-pull" ]]; then
  log "fetch + reset to $REF"
  git fetch --all --prune
  git reset --hard "$REF"
fi

log "install (frozen lockfile)"
pnpm install --frozen-lockfile

log "database migrations (oneshoplab_staging)"
pnpm db:migrate

log "build"
rm -f .next/BUILD_ID
pnpm build
if [[ ! -s .next/BUILD_ID ]]; then
  echo "✗ build produced no BUILD_ID — NOT restarting" >&2
  exit 1
fi
echo "BUILD_ID=$(cat .next/BUILD_ID)"

log "restart staging web + worker"
# See scripts/deploy.sh — startOrRestart can silently no-op and leave the old
# process serving the previous build.
pm2 delete oneshoplab-staging-web oneshoplab-staging-worker >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only oneshoplab-staging-web,oneshoplab-staging-worker >/dev/null
pm2 save >/dev/null
sleep 6

log "health check"
for path in /fr /fr/pricing /api/health; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://staging.oneshoplab.com${path}")
  printf '  %-14s %s\n' "$path" "$code"
  [[ "$code" == "200" ]] || { echo "✗ ${path} returned ${code}" >&2; exit 1; }
done

served=$(curl -s https://staging.oneshoplab.com/api/health | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')
printf '  %-14s %s\n' "served build" "${served:-unknown}"
[[ "$served" == "$(cat .next/BUILD_ID)" ]] || {
  echo "✗ the running process serves build '${served}', not $(cat .next/BUILD_ID)" >&2; exit 1; }
echo "✓ staging deployed $(git rev-parse --short HEAD)"
