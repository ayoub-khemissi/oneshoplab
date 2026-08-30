/**
 * AES-256-GCM envelope for stored third-party secrets (Shopify Admin tokens).
 * Ciphertext format: `v1:<iv b64>:<tag b64>:<data b64>` — the version prefix
 * is the key id, so a later key rotation can re-seal rows it recognises.
 * Key: `INTEGRATION_ENCRYPTION_KEY`, 32 bytes base64 (`openssl rand -base64 32`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SECRET_BOX_VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(
    message: string,
    public readonly reason: 'missing_key' | 'malformed_key' | 'malformed_ciphertext' | 'open_failed'
  ) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

function loadKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new SecretBoxError(
      'INTEGRATION_ENCRYPTION_KEY is not set (32 bytes base64, see .env.example)',
      'missing_key'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (
    key.length !== KEY_BYTES ||
    key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')
  ) {
    throw new SecretBoxError(
      'INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes encoded in base64',
      'malformed_key'
    );
  }
  return key;
}

/** True when the key is configured and well-formed (connect flows check before sealing). */
export function hasSecretBoxKey(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function sealSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_BOX_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    data.toString('base64')
  ].join(':');
}

export function openSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== SECRET_BOX_VERSION) {
    throw new SecretBoxError('Unrecognised ciphertext format', 'malformed_ciphertext');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('Unrecognised ciphertext format', 'malformed_ciphertext');
  }
  const key = loadKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError(
      'Ciphertext could not be opened (tampered or wrong key)',
      'open_failed'
    );
  }
}
