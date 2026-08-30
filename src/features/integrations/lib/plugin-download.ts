import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Metadata written next to the zip by scripts/ops; server-only (node:fs), never import from UI. */
const WP_PLUGIN_META_FILE = join(process.cwd(), 'public/downloads/oneshoplab-wp-plugin.json');

/**
 * Version of the WordPress plugin zip currently served, read on the server at
 * render time. Null when the metadata file is missing (fresh checkout, build
 * not run yet): the download button is still shown, just without a version.
 */
export function readWpPluginVersion(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(WP_PLUGIN_META_FILE, 'utf8'));
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : null;
    return typeof version === 'string' && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}
