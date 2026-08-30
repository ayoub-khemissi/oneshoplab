import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  verifySignature
} from '@/entities/api-key';

const key = 'osl_live_' + 'a'.repeat(43);
const parts = { method: 'post', path: '/api/v1/products/sync', body: '{"mode":"partial"}' };
const NOW = 1_800_000_000;

describe('X-OSL-Signature', () => {
  it('computes HMAC-SHA256(key, t.METHOD.path.sha256(body)) as in the spec', () => {
    const bodyHash = createHash('sha256').update(parts.body).digest('hex');
    const expected = createHmac('sha256', key)
      .update(`${NOW}.POST.${parts.path}.${bodyHash}`)
      .digest('hex');
    expect(computeSignature(key, NOW, parts)).toBe(expected);
    expect(buildSignatureHeader(key, parts, NOW)).toBe(`t=${NOW},v1=${expected}`);
  });
  it('parses the header leniently but strictly on shape', () => {
    expect(parseSignatureHeader('t=12, v1=' + 'ab'.repeat(32))).toEqual({
      t: 12,
      v1: 'ab'.repeat(32)
    });
    expect(parseSignatureHeader('v1=deadbeef')).toBeNull();
    expect(parseSignatureHeader('t=abc,v1=' + 'ab'.repeat(32))).toBeNull();
  });
  it('verifies a fresh valid signature', () => {
    const header = buildSignatureHeader(key, parts, NOW);
    expect(verifySignature(key, header, parts, NOW + 10)).toEqual({ ok: true, t: NOW });
  });
  it('reports missing / invalid / skewed distinctly', () => {
    expect(verifySignature(key, null, parts, NOW)).toMatchObject({ ok: false, reason: 'missing' });
    expect(verifySignature(key, 'garbage', parts, NOW)).toMatchObject({
      ok: false,
      reason: 'signature_invalid'
    });
    const wrongKey = buildSignatureHeader('osl_live_' + 'b'.repeat(43), parts, NOW);
    expect(verifySignature(key, wrongKey, parts, NOW)).toMatchObject({
      ok: false,
      reason: 'signature_invalid'
    });
    const old = buildSignatureHeader(key, parts, NOW - 301);
    expect(verifySignature(key, old, parts, NOW)).toMatchObject({
      ok: false,
      reason: 'clock_skew',
      serverTime: NOW
    });
    const edge = buildSignatureHeader(key, parts, NOW - 300);
    expect(verifySignature(key, edge, parts, NOW).ok).toBe(true);
    const future = buildSignatureHeader(key, parts, NOW + 301);
    expect(verifySignature(key, future, parts, NOW)).toMatchObject({ reason: 'clock_skew' });
  });
  it('rejects a tampered body, method or path', () => {
    const header = buildSignatureHeader(key, parts, NOW);
    expect(verifySignature(key, header, { ...parts, body: '{"mode":"full"}' }, NOW).ok).toBe(false);
    expect(verifySignature(key, header, { ...parts, method: 'GET' }, NOW).ok).toBe(false);
    expect(verifySignature(key, header, { ...parts, path: '/api/v1/site' }, NOW).ok).toBe(false);
  });
});
