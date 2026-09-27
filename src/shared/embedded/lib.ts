/**
 * Running inside the Shopify admin (the embedded app). The admin frames our
 * pages and third-party cookies are off the table (App Store requirement
 * 1.1.1), so the Shopify ID token is the session there:
 *   - the first document load carries it as `?id_token=`;
 *   - App Bridge adds it as `Authorization: Bearer` to every same-origin
 *     fetch, i.e. Next's client navigations and server actions;
 *   - a framed document says so itself (`Sec-Fetch-Dest: iframe`).
 */

/** Request header the proxy sets on requests coming from inside the admin. */
export const EMBEDDED_REQUEST_HEADER = 'x-osl-embedded';

/** Who may frame an embedded page (CSP `frame-ancestors`). */
export const SHOPIFY_FRAME_ANCESTORS = 'https://admin.shopify.com https://*.myshopify.com';

function jwtLike(token: string | null | undefined): token is string {
  return Boolean(token && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token));
}

export function embeddedRequestInfo(input: {
  secFetchDest: string | null;
  authorization: string | null;
  idTokenParam: string | null;
}): { embedded: boolean; bearer: string | null } {
  const header = /^Bearer\s+(\S+)$/i.exec(input.authorization?.trim() ?? '')?.[1] ?? null;
  const bearer = jwtLike(header) ? header : jwtLike(input.idTokenParam) ? input.idTokenParam : null;
  return { embedded: input.secFetchDest === 'iframe' || bearer !== null, bearer };
}

export type EmbeddedLinkAction = 'ignore' | 'navigate' | 'download';

/**
 * What a click on a plain `<a>` must become inside the admin. A document
 * navigation carries no Bearer header, so it would land logged out: app pages
 * go through the client router instead, and `/api/*` files are fetched (with
 * the header App Bridge adds) and saved. Next's `<Link>` already prevents the
 * default and never reaches this.
 */
export function embeddedLinkAction(
  link: { href: string; target: string | null; download: boolean },
  origin: string
): EmbeddedLinkAction {
  if (link.target && link.target !== '_self') return 'ignore';
  let url: URL;
  try {
    url = new URL(link.href, origin);
  } catch {
    return 'ignore';
  }
  if (url.origin !== origin) return 'ignore';
  if (url.pathname.startsWith('/api/')) return 'download';
  if (link.download) return 'ignore';
  // The embedded home is its own document: no server session to lose.
  if (url.pathname === '/shopify' || url.pathname.startsWith('/shopify/')) return 'ignore';
  return 'navigate';
}

/** `attachment; filename="x.csv"` → `x.csv`. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      return fallback;
    }
  }
  return /filename="?([^";]+)"?/i.exec(header ?? '')?.[1] ?? fallback;
}
