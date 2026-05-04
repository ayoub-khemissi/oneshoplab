import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match every path except:
  //   - Next.js internals (_next, _vercel)
  //   - API routes
  //   - Files served from /public ending with a known static extension
  //
  // The previous `.*\\..*` exclusion broke paths like /dashboard/sites/example.com
  // that legitimately contain a dot (the merchant's domain).
  matcher: [
    '/((?!api|_next|_vercel|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|css|js|map)$).*)'
  ]
};
