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
