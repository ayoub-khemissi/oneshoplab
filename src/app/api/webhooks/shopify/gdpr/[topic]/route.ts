import { handleShopifyGdprWebhook } from '@/features/shopify-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mandatory compliance webhooks of the public app: customers-data-request, customers-redact, shop-redact. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ topic: string }> }
): Promise<Response> {
  const { topic } = await params;
  const rawBody = await req.text();
  const outcome = await handleShopifyGdprWebhook({ segment: topic, rawBody, headers: req.headers });
  return Response.json(outcome.body, { status: outcome.status });
}
