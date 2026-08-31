import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WpPluginManifest } from './requirements';

/** Metadata written next to the zip by scripts/ops; server-only (node:fs), never import from UI. */
const WP_PLUGIN_META_FILE = join(process.cwd(), 'public/downloads/oneshoplab-wp-plugin.json');

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** All-or-nothing: a partially filled block would render half a requirements line. */
function readVersions<K extends string>(
  value: unknown,
  keys: readonly K[]
): Record<K, string> | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const version = readString(source, key);
    if (!version) return null;
    out[key] = version;
  }
  return out;
}

/**
 * The published plugin metadata, read on the server at render time. Null when
 * the file is missing (fresh checkout, sync script not run yet): the download
 * button is still shown, just without a version, and the requirements line of
 * the WooCommerce tutorial is hidden.
 */
export function readWpPluginManifest(): WpPluginManifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(WP_PLUGIN_META_FILE, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = parsed as Record<string, unknown>;
    return {
      version: readString(raw, 'version'),
      sha256: readString(raw, 'sha256'),
      builtAt: readString(raw, 'builtAt'),
      requires: readVersions(raw.requires, ['wordpress', 'woocommerce', 'php']),
      testedUpTo: readVersions(raw.testedUpTo, ['wordpress', 'woocommerce'])
    };
  } catch {
    return null;
  }
}
