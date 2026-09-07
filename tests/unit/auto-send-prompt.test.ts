/**
 * When to ask "send automatically?": once, at the moment it becomes a real
 * question, and never after an answer — whichever answer.
 */
import { describe, expect, it } from 'vitest';
import { shouldAskAutoSend } from '@/features/apply-to-store/lib/auto-send-prompt';

describe('shouldAskAutoSend', () => {
  it('asks a connected store that has never answered', () => {
    expect(shouldAskAutoSend({ connected: true, decidedAt: null, manual: false })).toBe(true);
  });
  it('has nothing to ask before the store is connected', () => {
    expect(shouldAskAutoSend({ connected: false, decidedAt: null, manual: false })).toBe(false);
  });
  it('never asks twice — "no" is an answer too', () => {
    expect(shouldAskAutoSend({ connected: true, decidedAt: new Date(), manual: false })).toBe(
      false
    );
  });
  it('a manual catalogue has no store to send to', () => {
    expect(shouldAskAutoSend({ connected: true, decidedAt: null, manual: true })).toBe(false);
  });
});
