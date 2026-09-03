import type { ConnectionCapabilities } from '@/shared/db/schema';

/**
 * "Can OneShopLab put an alt text on this photo at all?"
 *
 * It lives with the capabilities rather than with either feature that asks:
 * the image editor, the per-image button and the bulk run all need the same
 * answer, and features never import each other. The honest failure is a button
 * that is not there, never one that silently does nothing (IMAGE-OPS.md §7).
 */
export type AltImageKind = 'store' | 'generated';

export function canGenerateAlt(caps: ConnectionCapabilities, kind: AltImageKind): boolean {
  if (!caps.stableImageIds) return false;
  if (kind === 'store') return caps.altEditable && caps.imageOps.includes('set_alt');
  // A generation carries its alt in the payload (set at creation time), so it
  // needs no `set_alt` — only a verb that puts the image on the product.
  return (
    caps.imageOps.includes('append') ||
    caps.imageOps.includes('replace') ||
    caps.imageOps.includes('set_featured')
  );
}

/** A whole-catalog pass only ever rewrites photos the store already holds. */
export function canRunAltBatch(caps: ConnectionCapabilities): boolean {
  return canGenerateAlt(caps, 'store');
}

/** An empty or blank alt is a missing one — a space helps no screen reader. */
export function isMissingAlt(alt: string | null | undefined): boolean {
  return !alt || alt.trim().length === 0;
}
