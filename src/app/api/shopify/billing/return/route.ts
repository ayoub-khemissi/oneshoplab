import { normalizeShopDomain } from '@/entities/shop-connection';
import { confirmShopifyReturn, embeddedAppUrl } from '@/features/shopify-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shopify sends the merchant here after they approve (or decline) a charge.
 * Nothing in the query is trusted: the shop's subscription or purchase is
 * read back from the Admin API before any credit moves, and every grant is
 * idempotent. Then the merchant goes back into the embedded app.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const shop = normalizeShopDomain(url.searchParams.get('shop') ?? '');
  const kind = url.searchParams.get('kind') === 'pack' ? 'pack' : 'subscription';
  if (!shop) return Response.json({ error: 'bad_shop' }, { status: 400 });
  try {
    await confirmShopifyReturn(shop, kind, url.searchParams.get('charge_id'));
  } catch (e) {
    console.error('[shopify billing] return', shop, e instanceof Error ? e.message : e);
  }
  return Response.redirect(embeddedAppUrl(shop), 302);
}
