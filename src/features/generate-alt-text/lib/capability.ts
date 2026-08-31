/**
 * "Can OSL put an alt text on this photo at all?" — decided again server-side.
 *
 * The same rule is encoded client-side in the image editor's `tileActions`
 * (features/apply-to-store): a feature never imports another feature, and the
 * server must decide for itself anyway (a client is a suggestion, never an
 * authority). Keep the two in step — the honest failure is a button that is
 * not there, never one that silently does nothing (IMAGE-OPS.md §7).
 */
import type { ConnectionCapabilities } from '@/shared/db/schema';

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

/** The batch only ever writes `set_alt` on photos already in the store. */
export function canRunAltBatch(caps: ConnectionCapabilities): boolean {
  return canGenerateAlt(caps, 'store');
}
