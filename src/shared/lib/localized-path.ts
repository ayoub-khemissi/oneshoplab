import { getLocale } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

/**
 * Prefix an app path with the request locale (`/dashboard` → `/fr/dashboard`).
 * Routing is `localePrefix: 'always'`: a redirect to an unprefixed path is
 * served through a rewrite, so the browser ends up on a non-canonical URL
 * (seen after signup/login in production). Auth.js `redirectTo` and any
 * hand-built redirect must go through here. Idempotent on prefixed paths.
 */
export async function localizedPath(path: string): Promise<string> {
  const first = path.split('?')[0].split('/')[1] ?? '';
  if ((SUPPORTED_LOCALES as readonly string[]).includes(first)) return path;
  const locale = await getLocale();
  return path === '/' || path.startsWith('/?') ? `/${locale}${path.slice(1)}` : `/${locale}${path}`;
}
