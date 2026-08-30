import { describe, expect, it } from 'vitest';
import { SecretBoxError, hasSecretBoxKey, openSecret, sealSecret } from '@/shared/lib';

const KEY_A = process.env.INTEGRATION_ENCRYPTION_KEY;
const KEY_B = Buffer.alloc(32, 7).toString('base64');

describe('secret-box (AES-256-GCM)', () => {
  it('round-trips and never repeats a ciphertext', () => {
    expect(hasSecretBoxKey()).toBe(true);
    const a = sealSecret('shpat_secret_token');
    const b = sealSecret('shpat_secret_token');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a.split(':')).toHaveLength(4);
    expect(a).not.toContain('shpat');
    expect(openSecret(a)).toBe('shpat_secret_token');
    expect(openSecret(b)).toBe('shpat_secret_token');
    expect(openSecret(sealSecret(''))).toBe('');
  });

  it('throws on tampered data, tag or format', () => {
    const sealed = sealSecret('hello');
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    expect(() => openSecret([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow(
      SecretBoxError
    );
    const badTag = Buffer.from(tag, 'base64');
    badTag[3] ^= 0x01;
    expect(() => openSecret([v, iv, badTag.toString('base64'), data].join(':'))).toThrow(
      SecretBoxError
    );
    expect(() => openSecret('v2:x:y:z')).toThrow(SecretBoxError);
    expect(() => openSecret('garbage')).toThrow(SecretBoxError);
  });

  it('throws with the wrong key and a clear error without a key', () => {
    const sealed = sealSecret('hello');
    process.env.INTEGRATION_ENCRYPTION_KEY = KEY_B;
    try {
      expect(() => openSecret(sealed)).toThrow(/tampered or wrong key/);
      process.env.INTEGRATION_ENCRYPTION_KEY = 'not-32-bytes';
      expect(hasSecretBoxKey()).toBe(false);
      expect(() => sealSecret('x')).toThrow(/exactly 32 bytes/);
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
      expect(() => sealSecret('x')).toThrow(/INTEGRATION_ENCRYPTION_KEY is not set/);
    } finally {
      process.env.INTEGRATION_ENCRYPTION_KEY = KEY_A;
    }
    expect(openSecret(sealed)).toBe('hello');
  });
});
