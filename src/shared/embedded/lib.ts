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
/** Request header naming which admin (`shopify` | `wix`), set by the proxy too. */
export const EMBEDDED_HOST_HEADER = 'x-osl-embedded-host';
/** Issuer of our Wix session token (entities/shop-connection signs and verifies it). */
export const WIX_SESSION_ISSUER = 'oneshoplab:wix';

/** The store admins OneShopLab runs inside. */
export const EMBEDDED_HOSTS = ['shopify', 'wix'] as const;
export type EmbeddedHost = (typeof EMBEDDED_HOSTS)[number];

/** Each admin's home of the app: its own document, outside the locale router. */
export function embeddedHomePath(host: EmbeddedHost): string {
  return host === 'wix' ? '/wix' : '/shopify';
}

/** Who may frame an embedded page (CSP `frame-ancestors`). */
export const SHOPIFY_FRAME_ANCESTORS = 'https://admin.shopify.com https://*.myshopify.com';
/** The Wix dashboard and editors (`{user}-{site}.{editor|studio|harmony}.wix.com`). */
export const WIX_FRAME_ANCESTORS = 'https://manage.wix.com https://*.wix.com';

/**
 * The query parameter a Wix-framed document load carries our session token
 * in (Shopify's is `id_token`). A distinct name lets nginx tell the two
 * admins apart without reading the token: App Bridge is only for Shopify.
 */
export const WIX_TOKEN_PARAM = 'osl_token';

function jwtLike(token: string | null | undefined): token is string {
  return Boolean(token && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token));
}

export function embeddedRequestInfo(input: {
  secFetchDest: string | null;
  authorization: string | null;
  idTokenParam: string | null;
  wixTokenParam?: string | null;
}): { embedded: boolean; bearer: string | null } {
  const header = /^Bearer\s+(\S+)$/i.exec(input.authorization?.trim() ?? '')?.[1] ?? null;
  const bearer = jwtLike(header)
    ? header
    : jwtLike(input.idTokenParam)
      ? input.idTokenParam
      : jwtLike(input.wixTokenParam)
        ? input.wixTokenParam
        : null;
  return { embedded: input.secFetchDest === 'iframe' || bearer !== null, bearer };
}

/**
 * Which admin a framed request comes from — no verification here, only
 * routing (which home, which frame-ancestors); `auth()` verifies the token.
 * Our Wix token names its issuer; the Wix home and a Wix referrer count too.
 */
export function embeddedHostOf(input: {
  bearer: string | null;
  pathname: string;
  referer: string | null;
}): EmbeddedHost {
  if (input.pathname === '/wix' || input.pathname.startsWith('/wix/')) return 'wix';
  const body = input.bearer?.split('.')[1];
  if (body) {
    try {
      const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
        iss?: unknown;
      };
      if (claims.iss === WIX_SESSION_ISSUER) return 'wix';
      return 'shopify';
    } catch {
      // not a JWT we know: fall through
    }
  }
  try {
    const host = input.referer ? new URL(input.referer).hostname : '';
    if (host === 'wix.com' || host.endsWith('.wix.com')) return 'wix';
  } catch {
    // no usable referrer
  }
  return 'shopify';
}

export type EmbeddedLinkAction = 'ignore' | 'navigate' | 'download' | 'home';

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
  // The embedded homes are their own documents: Shopify's gets a fresh ID
  // token from App Bridge; Wix's needs our token in its URL.
  if (url.pathname === '/shopify' || url.pathname.startsWith('/shopify/')) return 'ignore';
  if (url.pathname === '/wix' || url.pathname.startsWith('/wix/')) return 'home';
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
