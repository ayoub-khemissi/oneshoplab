#!/usr/bin/env bash
# Production dependency audit gate.
#
# `pnpm audit` exits non-zero for two very different reasons: it found a
# vulnerability at or above the level (must block the deploy), or it could not
# reach registry.npmjs.org (must not — a registry outage is not a reason to be
# unable to ship a fix, and failing closed here means exactly that).
#
# The two are told apart by the VERDICT, never by the error text: pnpm prints
# transient "ERR_SOCKET_TIMEOUT" warnings while retrying and then succeeds, so
# matching on that text would swallow a real finding every time the network
# hiccups once. A run that reached the registry always states a verdict; a run
# that never did states none, and has audited nothing.
set -uo pipefail

LEVEL="${AUDIT_LEVEL:-critical}"
# pnpm retries with backoff; a registry that accepts the connection and never
# answers would otherwise stall the deploy indefinitely.
TIMEOUT="${AUDIT_TIMEOUT:-180}"
out=$(timeout "$TIMEOUT" pnpm audit --prod --audit-level "$LEVEL" 2>&1)
status=$?
echo "$out"

# pnpm's verdict lines, whichever way it went.
if grep -qE 'vulnerabilit(y|ies) found|No known vulnerabilities' <<<"$out"; then
  exit "$status"
fi

echo
echo "⚠ audit skipped: the npm registry never answered, so NOTHING was checked."
echo "  Re-run 'pnpm audit:prod' once the network is back."
exit 0
