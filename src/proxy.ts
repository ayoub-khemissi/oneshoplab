import { getToken } from 'next-auth/jwt';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { REFERRAL_COOKIE, refFromSearchParams } from './entities/referral/lib/ref';
import { routing, SUPPORTED_LOCALES } from './i18n/routing';

/** A promoter's click is worth ninety days, the industry's window. */
const REFERRAL_MAX_AGE = 90 * 24 * 60 * 60;

/**
 * An influencer's link carries their referral id. Remember it here, on the very
 * first response, so it survives the visitor reading three pages and signing up
 * a week later — and so the attribution needs no third-party script and no
 * third-party cookie. First writer wins: the promoter who actually brought the
 * visitor is the one who gets the credit.
 */
function rememberReferral(req: NextRequest, res: NextResponse): NextResponse {
  const refId = refFromSearchParams(req.nextUrl.searchParams);
  if (!refId || req.cookies.get(REFERRAL_COOKIE)) return res;
  res.cookies.set(REFERRAL_COOKIE, refId, {
    maxAge: REFERRAL_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: (process.env.APP_URL ?? 'https://').startsWith('https://')
  });
  return res;
}

const intlMiddleware = createMiddleware(routing);

// Routes that only make sense when the visitor is NOT logged in.
// Visiting them while authenticated bounces to the dashboard so the
// header / nav state stays consistent. `/reset-password` is omitted
// on purpose: it operates on an email token and should work even if
// the user happens to have an active session in another tab.
const GUEST_ONLY = ['/login', '/signup', '/forgot-password'];

// Routes that require a session. Hitting them while logged out sends
// the visitor to /login with `?next=<original>` so they land back on
// their target after authenticating.
const AUTH_REQUIRED = ['/dashboard', '/account'];

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

function splitLocale(pathname: string): {
  locale: string | null;
  rest: string;
} {
  // pathname always starts with "/", so split[0] is "" and split[1]
  // is the first segment.
  const segments = pathname.split('/');
  const maybeLocale = segments[1] ?? '';
  if (LOCALE_SET.has(maybeLocale)) {
    const rest = '/' + segments.slice(2).join('/');
    return { locale: maybeLocale, rest: rest === '/' ? '/' : rest.replace(/\/$/, '') };
  }
  return { locale: null, rest: pathname };
}

function matchesRoute(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + '/'));
}

export default async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const { locale, rest } = splitLocale(pathname);

  // Bare paths (no locale prefix) are handled by next-intl's locale
  // negotiation first. Auth checks run on the subsequent request once
  // the locale has been resolved.
  if (locale) {
    const isGuestOnly = matchesRoute(rest, GUEST_ONLY);
    const isAuthRequired = matchesRoute(rest, AUTH_REQUIRED);

    if (isGuestOnly || isAuthRequired) {
      // getToken decodes the Auth.js JWT cookie locally — no DB hit,
      // edge-safe. Returns null when the cookie is missing or invalid.
      const token = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        // Auth.js v5 uses host-bound prefixes in production for the
        // session cookie so the Set-Cookie can't be tampered by
        // sub-domains. getToken auto-detects the right name based on
        // the request's URL scheme, but we pin it explicitly to avoid
        // surprises behind nginx where req.url may appear http even
        // though the user-facing URL is https.
        // Auth.js derives the name from the protocol of AUTH_URL (`__Secure-` on
        // https), not from NODE_ENV — keying on NODE_ENV made a production build
        // served over http (e2e, local blue/green) look logged-out. Env-based, so
        // nginx's http upstream does not affect it.
        secureCookie: (process.env.AUTH_URL ?? process.env.APP_URL ?? 'https://').startsWith(
          'https://'
        )
      });
      const isAuthed = Boolean(token);

      if (isAuthed && isGuestOnly) {
        return rememberReferral(
          req,
          NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url))
        );
      }
      if (!isAuthed && isAuthRequired) {
        const url = new URL(`/${locale}/login`, req.url);
        // Preserve the originally requested path + query so login can
        // bounce the user back where they intended to go.
        url.searchParams.set('next', pathname + (search ?? ''));
        return rememberReferral(req, NextResponse.redirect(url));
      }
    }
  }

  return rememberReferral(req, intlMiddleware(req) as NextResponse);
}

export const config = {
  // Match every path except:
  //   - Next.js internals (_next, _vercel)
  //   - API routes
  //   - Files served from /public ending with a known static extension
  //   - The service worker and its offline page: a locale redirect on either
  //     breaks `cache.addAll` at install time, so the worker never activates
  //
  // The previous `.*\\..*` exclusion broke paths like /dashboard/sites/example.com
  // that legitimately contain a dot (the merchant's domain).
  matcher: [
    '/((?!api|downloads|_next|_vercel|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js|offline\\.html|opengraph-image|twitter-image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|css|js|map)$).*)'
  ]
};
