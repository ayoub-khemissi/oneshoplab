import { describe, expect, it } from 'vitest';
import { normalizeRefId, refFromSearchParams } from '@/entities/referral/lib/ref';

describe('normalizeRefId', () => {
  it('keeps a plain promoter handle', () => {
    expect(normalizeRefId('marie-boutique')).toBe('marie-boutique');
    expect(normalizeRefId('  ABC_123  ')).toBe('ABC_123');
  });

  it('refuses anything that is not a handle', () => {
    expect(normalizeRefId('marie boutique')).toBeNull();
    expect(normalizeRefId('<script>')).toBeNull();
    expect(normalizeRefId('a'.repeat(65))).toBeNull();
    expect(normalizeRefId('')).toBeNull();
    expect(normalizeRefId(null)).toBeNull();
  });
});

describe('refFromSearchParams', () => {
  it('reads the network parameter first', () => {
    const params = new URLSearchParams('ref=other&fpr=marie');
    expect(refFromSearchParams(params)).toBe('marie');
  });

  it('accepts the aliases the rest of the industry uses', () => {
    expect(refFromSearchParams(new URLSearchParams('via=paul'))).toBe('paul');
    expect(refFromSearchParams(new URLSearchParams('ref=paul'))).toBe('paul');
  });

  it('ignores a parameter that is not a handle', () => {
    expect(refFromSearchParams(new URLSearchParams('fpr=not a handle'))).toBeNull();
  });

  it('is null on a plain URL', () => {
    expect(refFromSearchParams(new URLSearchParams('utm_source=newsletter'))).toBeNull();
  });
});
