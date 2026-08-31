import type { ApiKeyRow } from '@/entities/api-key';
import type { SiteKeyState, SiteKeySummary } from '../model/types';

export function keyState(row: ApiKeyRow, now: Date = new Date()): SiteKeyState {
  if (row.revokedAt) return 'revoked';
  if (row.graceUntil) return row.graceUntil.getTime() <= now.getTime() ? 'revoked' : 'grace';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function isUsableKey(row: ApiKeyRow, now: Date = new Date()): boolean {
  const state = keyState(row, now);
  return state === 'active' || state === 'grace';
}

export function toSiteKeySummary(row: ApiKeyRow, now: Date = new Date()): SiteKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    state: keyState(row, now),
    createdAtIso: row.createdAt.toISOString(),
    lastUsedAtIso: row.lastUsedAt?.toISOString() ?? null,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    graceUntilIso: row.graceUntil?.toISOString() ?? null,
    revokedAtIso: row.revokedAt?.toISOString() ?? null
  };
}

/** How many retired keys the history shows before it stops listing them. */
export const MAX_PAST_KEYS_SHOWN = 5;

/**
 * Keys worth acting on, and the rest. A store that rotated a few times ends up
 * with a wall of revoked keys — none of which the merchant can do anything
 * with — hiding the one that matters. Live keys come first (active before a
 * key living out its grace period), retired ones newest-first behind a toggle.
 */
export function partitionSiteKeys(keys: SiteKeySummary[]): {
  live: SiteKeySummary[];
  past: SiteKeySummary[];
} {
  const byNewest = (a: SiteKeySummary, b: SiteKeySummary) =>
    b.createdAtIso.localeCompare(a.createdAtIso);
  const live = keys
    .filter((k) => k.state === 'active' || k.state === 'grace')
    .sort((a, b) => (a.state === b.state ? byNewest(a, b) : a.state === 'active' ? -1 : 1));
  const past = keys.filter((k) => k.state === 'revoked' || k.state === 'expired').sort(byNewest);
  return { live, past };
}
