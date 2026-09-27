import { signIn } from '@/entities/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Ouvrir OneShopLab" from the Shopify admin: the single-use ticket minted by
 * the embedded app becomes a normal session in this tab.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const nextRaw = url.searchParams.get('next') ?? '/';
  // Same-site paths only: no open redirect through the SSO endpoint.
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';
  try {
    await signIn('shopify-sso', { token, redirectTo: next });
  } catch (e) {
    // signIn redirects by throwing NEXT_REDIRECT: let that one through.
    if (
      e &&
      typeof e === 'object' &&
      'digest' in e &&
      String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw e;
    }
    return Response.redirect(new URL('/login?error=sso', url.origin), 302);
  }
  return Response.redirect(new URL(next, url.origin), 302);
}
