/**
 * Monotonic ULID (https://github.com/ulid/spec): 48-bit ms timestamp +
 * 80-bit randomness, Crockford base32, 26 chars. Two ids generated in the
 * same millisecond by this process are strictly increasing (the random
 * part is incremented), so a ULID column can double as a listing cursor.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const RANDOM_BYTES = 10;
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let lastTime = -1;
let lastRandom = Buffer.alloc(RANDOM_BYTES);

function encodeTime(time: number): string {
  let out = '';
  let t = time;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(bytes: Buffer): string {
  // 80 bits → 16 base32 chars: walk the bit stream 5 bits at a time.
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, RANDOM_LEN);
}

function increment(bytes: Buffer): boolean {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] < 0xff) {
      bytes[i]++;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    // Same ms: bump the random part so ordering holds within the ms.
    // Overflow (2^80 ids in one ms) is unreachable in practice; fall back
    // to a fresh draw one ms later rather than wrapping around.
    if (!increment(lastRandom)) {
      lastTime = now + 1;
      lastRandom = randomBytes(RANDOM_BYTES);
    }
  } else if (now > lastTime) {
    lastTime = now;
    lastRandom = randomBytes(RANDOM_BYTES);
  } else {
    // Clock went backwards: keep monotonicity by reusing the last time.
    if (!increment(lastRandom)) {
      lastTime += 1;
      lastRandom = randomBytes(RANDOM_BYTES);
    }
  }
  return encodeTime(lastTime) + encodeRandom(lastRandom);
}

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
