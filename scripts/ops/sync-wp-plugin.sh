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
command -v jq >/dev/null || { echo "jq is required to write the metadata"; exit 1; }
VERSION=$(grep -oE "^\s*\*\s*Version:\s*[0-9.]+" "$PLUGIN_DIR/oneshoplab.php" | grep -oE "[0-9.]+$")
( cd "$PLUGIN_DIR" && bash bin/lint.sh >/dev/null && php tests/run.php >/dev/null && bash bin/build-zip.sh >/dev/null )
OUT="$APP_DIR/public/downloads"
mkdir -p "$OUT"
cp "$PLUGIN_DIR/dist/oneshoplab-$VERSION.zip" "$OUT/oneshoplab-wp-plugin-$VERSION.zip"
cp "$PLUGIN_DIR/dist/oneshoplab-$VERSION.zip" "$OUT/oneshoplab-wp-plugin.zip"

# Compatibility numbers rendered under "Durée estimée" in the wizard tutorials
# (src/features/integrations/lib/requirements.ts reads them from this json).
# The plugin repo owns them in compat.json; readme.txt is the fallback for a
# checkout that predates it. Values keep their comparator (">=6.0") — the UI
# strips it — and a missing field simply hides the line.
readme_field() {
  { grep -m1 -E "^$1:" "$PLUGIN_DIR/readme.txt" | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '\r'; } || true
}
if [[ -f "$PLUGIN_DIR/compat.json" ]]; then
  COMPAT="$PLUGIN_DIR/compat.json"
  WP_MIN=$(jq -r '.wordpress // empty' "$COMPAT")
  WC_MIN=$(jq -r '.woocommerce // empty' "$COMPAT")
  PHP_MIN=$(jq -r '.php // empty' "$COMPAT")
  WP_TESTED=$(jq -r '.testedUpTo.wordpress // empty' "$COMPAT")
  WC_TESTED=$(jq -r '.testedUpTo.woocommerce // empty' "$COMPAT")
else
  WP_MIN=$(readme_field 'Requires at least')
  WC_MIN=$(readme_field 'WC requires at least')
  PHP_MIN=$(readme_field 'Requires PHP')
  WP_TESTED=$(readme_field 'Tested up to')
  WC_TESTED=$(readme_field 'WC tested up to')
fi

jq -n \
  --arg version "$VERSION" \
  --arg sha256 "$(sha256sum "$OUT/oneshoplab-wp-plugin.zip" | cut -d' ' -f1)" \
  --arg builtAt "$(date -u +%FT%TZ)" \
  --arg wp "$WP_MIN" --arg wc "$WC_MIN" --arg php "$PHP_MIN" \
  --arg wpTested "$WP_TESTED" --arg wcTested "$WC_TESTED" \
  '{ version: $version, sha256: $sha256, builtAt: $builtAt }
   + (if ($wp != "" and $wc != "" and $php != "")
      then { requires: { wordpress: $wp, woocommerce: $wc, php: $php } } else {} end)
   + (if ($wpTested != "" and $wcTested != "")
      then { testedUpTo: { wordpress: $wpTested, woocommerce: $wcTested } } else {} end)' \
  > "$OUT/oneshoplab-wp-plugin.json"
echo "published $VERSION → $OUT"
