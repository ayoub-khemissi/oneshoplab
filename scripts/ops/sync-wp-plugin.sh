#!/usr/bin/env bash
# Build the WooCommerce plugin from the sibling repo and publish the zip under
# public/downloads so the Integrations wizard can link to it:
#   https://oneshoplab.com/downloads/oneshoplab-wp-plugin.zip   (latest)
#   https://oneshoplab.com/downloads/oneshoplab-wp-plugin-<version>.zip
# Commit the result — the app deploy serves public/ as-is.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN_DIR="${ONESHOPLAB_WP_PLUGIN_DIR:-$APP_DIR/../oneshoplab-wp-plugin}"
[[ -f "$PLUGIN_DIR/oneshoplab.php" ]] || { echo "plugin repo not found at $PLUGIN_DIR"; exit 1; }
VERSION=$(grep -oE "^\s*\*\s*Version:\s*[0-9.]+" "$PLUGIN_DIR/oneshoplab.php" | grep -oE "[0-9.]+$")
( cd "$PLUGIN_DIR" && bash bin/lint.sh >/dev/null && php tests/run.php >/dev/null && bash bin/build-zip.sh >/dev/null )
OUT="$APP_DIR/public/downloads"
mkdir -p "$OUT"
cp "$PLUGIN_DIR/dist/oneshoplab-$VERSION.zip" "$OUT/oneshoplab-wp-plugin-$VERSION.zip"
cp "$PLUGIN_DIR/dist/oneshoplab-$VERSION.zip" "$OUT/oneshoplab-wp-plugin.zip"
printf '{ "version": "%s", "sha256": "%s", "builtAt": "%s" }\n' "$VERSION" "$(sha256sum "$OUT/oneshoplab-wp-plugin.zip" | cut -d' ' -f1)" "$(date -u +%FT%TZ)" > "$OUT/oneshoplab-wp-plugin.json"
echo "published $VERSION → $OUT"
