import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/entities/user';
import { WIX_STATE_COOKIE, completeWixInstall } from '@/features/wix-connector';
import { integrationsTabPath } from '@/shared/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Wix redirects here with `code, instanceId, state` (docs/api/WIX-CONNECTOR.md). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const session = await auth();
  const res = await completeWixInstall({
    query: url.searchParams,
    cookieValue: req.cookies.get(WIX_STATE_COOKIE)?.value ?? null,
    sessionUserId: session?.user?.id ?? null
  });
  const target = res.ok
    ? integrationsTabPath(res.locale, res.projectId, { connected: 'wix' })
    : res.state
      ? integrationsTabPath(res.state.locale, res.state.projectId, { error: res.reason })
      : `/en/dashboard?error=${res.reason}`;
  const redirect = NextResponse.redirect(new URL(target, url.origin));
  redirect.cookies.set(WIX_STATE_COOKIE, '', { path: '/api/integrations/wix', maxAge: 0 });
  return redirect;
}
