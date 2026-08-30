/**
 * Canonical JSON (sorted object keys, no whitespace) → sha256 hex. Plugins
 * hash the store's current field value the same way to detect conflicts,
 * so this canonicalisation is part of the API contract.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] !== undefined) out[k] = sortKeys(src[k]);
    }
    return out;
  }
  return value ?? null;
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
