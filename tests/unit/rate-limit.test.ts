import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimits, take } from '@/shared/api';

const opts = { capacity: 3, refillPerSec: 1 };

beforeEach(() => resetRateLimits());

describe('token bucket', () => {
  it('allows a burst up to capacity then refuses with Retry-After', () => {
    const t = 1_000_000;
    expect(take('k', opts, t).ok).toBe(true);
    expect(take('k', opts, t).ok).toBe(true);
    expect(take('k', opts, t)).toMatchObject({ ok: true, remaining: 0 });
    expect(take('k', opts, t)).toMatchObject({ ok: false, retryAfterSec: 1 });
  });
  it('refills over time and caps at capacity', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) take('k', opts, t);
    expect(take('k', opts, t + 500).ok).toBe(false);
    expect(take('k', opts, t + 1_000).ok).toBe(true);
    expect(take('k', opts, t + 100_000)).toMatchObject({ ok: true, remaining: 2 });
  });
  it('keys are independent', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) take('a', opts, t);
    expect(take('a', opts, t).ok).toBe(false);
    expect(take('b', opts, t).ok).toBe(true);
  });
});
