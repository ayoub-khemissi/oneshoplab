import { describe, expect, it } from 'vitest';
import {
  PLUGIN_POLL_INTERVAL_MS,
  SYNC_REQUEST_COOLDOWN_MS,
  cooldownRemainingMs,
  msUntilNextCheck
} from '@/features/integrations/lib/sync-schedule';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('msUntilNextCheck', () => {
  it('counts down to the next poll', () => {
    expect(msUntilNextCheck(ago(60_000), NOW)).toBe(PLUGIN_POLL_INTERVAL_MS - 60_000);
  });

  it('says nothing when the store never called', () => {
    expect(msUntilNextCheck(null, NOW)).toBeNull();
  });

  it('says nothing about a store that went quiet — it is late, not scheduled', () => {
    expect(msUntilNextCheck(ago(PLUGIN_POLL_INTERVAL_MS * 4), NOW)).toBeNull();
  });

  it('rolls over inside the cycle rather than going negative', () => {
    const value = msUntilNextCheck(ago(PLUGIN_POLL_INTERVAL_MS + 30_000), NOW);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(PLUGIN_POLL_INTERVAL_MS);
  });
});

describe('cooldownRemainingMs', () => {
  it('is free when nothing was ever asked', () => {
    expect(cooldownRemainingMs(null, NOW)).toBe(0);
  });

  it('holds the button for the rest of the minute', () => {
    expect(cooldownRemainingMs(ago(20_000), NOW)).toBe(SYNC_REQUEST_COOLDOWN_MS - 20_000);
  });

  it('is free again once the minute has passed', () => {
    expect(cooldownRemainingMs(ago(SYNC_REQUEST_COOLDOWN_MS + 1), NOW)).toBe(0);
  });
});
