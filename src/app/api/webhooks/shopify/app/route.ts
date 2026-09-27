import { handleShopifyAppWebhook } from '@/features/shopify-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** App-level webhooks declared in shopify.app.toml: app/uninstalled and the two billing topics. */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const outcome = await handleShopifyAppWebhook({ rawBody, headers: req.headers });
  return Response.json(outcome.body, { status: outcome.status });
}
