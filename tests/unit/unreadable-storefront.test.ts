/**
 * "We could not read this storefront" is the most common outcome of a first
 * audit, and it is not the merchant's fault. Presenting it as a failure — a red
 * banner, a bell notice saying the audit failed, a "try again" button under a
 * warning triangle — teaches a visitor that the product does not work, at the
 * exact moment they were closest to signing up.
 */
import { describe, expect, it } from 'vitest';
import { isUnreadableStorefront } from '@/features/run-audit/lib/unreadable-storefront';

describe('isUnreadableStorefront', () => {
  it('recognises the reasons a storefront tells us nothing', () => {
    for (const error of ['platform_not_detected', 'no_report']) {
      expect(isUnreadableStorefront({ error, source: 'storefront', hasConnection: false })).toBe(
        true
      );
    }
  });

  it('still recognises the sentence stored before the reasons became codes', () => {
    expect(
      isUnreadableStorefront({
        error: 'Could not detect a supported e-commerce platform on this URL.',
        source: 'storefront',
        hasConnection: false
      })
    ).toBe(true);
  });

  it('leaves a connected store its real failure', () => {
    // There the merchant has no further step to take, and softening it would
    // leave them with a store that quietly stopped being analysed.
    expect(
      isUnreadableStorefront({
        error: 'platform_not_detected',
        source: 'storefront',
        hasConnection: true
      })
    ).toBe(false);
    expect(
      isUnreadableStorefront({
        error: 'platform_not_detected',
        source: 'connection',
        hasConnection: false
      })
    ).toBe(false);
  });

  it('does not swallow a failure it has no answer for', () => {
    for (const error of ['process_interrupted', 'boom', null]) {
      expect(isUnreadableStorefront({ error, source: 'storefront', hasConnection: false })).toBe(
        false
      );
    }
  });
});
