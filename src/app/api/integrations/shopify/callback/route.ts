import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/entities/user';
import { SHOPIFY_STATE_COOKIE, completeShopifyInstall } from '@/features/shopify-connector';
import { integrationsTabPath } from '@/shared/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shopify redirects here with `code, hmac, shop, state, timestamp` (docs/api/SHOPIFY-CONNECTOR.md). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const session = await auth();
  const res = await completeShopifyInstall({
    query: url.searchParams,
    cookieValue: req.cookies.get(SHOPIFY_STATE_COOKIE)?.value ?? null,
    sessionUserId: session?.user?.id ?? null
  });
  const target = res.ok
    ? integrationsTabPath(res.locale, res.projectId, {
        connected: 'shopify',
        ...(res.webhooks === 'failed' ? { warning: 'webhooks_failed' } : {})
      })
    : res.state
      ? integrationsTabPath(res.state.locale, res.state.projectId, { error: res.reason })
      : `/en/dashboard?error=${res.reason}`;
  const redirect = NextResponse.redirect(new URL(target, url.origin));
  redirect.cookies.set(SHOPIFY_STATE_COOKIE, '', { path: '/api/integrations/shopify', maxAge: 0 });
  return redirect;
}
