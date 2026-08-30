import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/entities/user';
import { SHOPIFY_STATE_COOKIE, beginShopifyInstall } from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { OAUTH_STATE_TTL_MS, integrationsTabPath, safeLocale } from '@/shared/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET ?projectId&shop[&locale]` — owner only → 302 to Shopify's authorize page. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  const locale = safeLocale(url.searchParams.get('locale'));
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const bounce = (error: string) =>
    NextResponse.redirect(new URL(integrationsTabPath(locale, projectId, { error }), url.origin));
  if (!projectId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)));
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const res = beginShopifyInstall({
    projectId,
    userId: session.user.id,
    shop: url.searchParams.get('shop') ?? '',
    locale
  });
  if (!res.ok) return bounce(res.reason);
  const redirect = NextResponse.redirect(res.url);
  redirect.cookies.set(SHOPIFY_STATE_COOKIE, res.cookieValue, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/integrations/shopify',
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000)
  });
  return redirect;
}
