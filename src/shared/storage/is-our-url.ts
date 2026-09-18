import { keyFromPublicUrl } from './r2';

/**
 * True when `url` already points at our own bucket (canonical CDN base or
 * any legacy alias). Used to skip mirroring an image that is already ours.
 * Always false while R2 is not configured — there is no "ours" to match then.
 */
export function isOurStorageUrl(url: string): boolean {
  return keyFromPublicUrl(url) !== null;
}
