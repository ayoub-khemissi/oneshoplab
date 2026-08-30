import { describe, expect, it } from 'vitest';
import { isUlid, ulid } from '@/shared/lib';

describe('ulid', () => {
  it('is 26 Crockford base32 chars', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(id).not.toMatch(/[ILOU]/);
  });
  it('orders lexicographically across time', () => {
    const a = ulid(1_000_000);
    const b = ulid(1_000_001);
    const c = ulid(Date.now());
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });
  it('is monotonic within the same millisecond and never duplicates', () => {
    const now = Date.now() + 10_000;
    const ids = Array.from({ length: 10_000 }, () => ulid(now));
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1);
  });
});
