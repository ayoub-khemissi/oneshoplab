import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_RE,
  generateApiKey,
  hashKey,
  looksLikeApiKey,
  prefixOf,
  timingSafeEqualHex
} from '@/entities/api-key';

describe('site key format', () => {
  it('generates osl_live_ + 43 base64url chars', () => {
    const k = generateApiKey();
    expect(k).toMatch(API_KEY_RE);
    expect(k).toHaveLength(9 + 43);
    expect(looksLikeApiKey(k)).toBe(true);
    expect(looksLikeApiKey('osl_test_' + k.slice(9))).toBe(false);
    expect(looksLikeApiKey(k + 'x')).toBe(false);
  });
  it('prefix = first 12 chars, hash = sha256 hex', () => {
    const k = generateApiKey();
    expect(prefixOf(k)).toBe(k.slice(0, 12));
    expect(prefixOf(k)).toHaveLength(12);
    expect(hashKey(k)).toBe(createHash('sha256').update(k).digest('hex'));
  });
  it('timingSafeEqualHex compares digests and rejects malformed input', () => {
    const a = hashKey('a');
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, hashKey('b'))).toBe(false);
    expect(timingSafeEqualHex(a, a.slice(0, 62))).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualHex('zz', 'zz')).toBe(false);
  });
});
