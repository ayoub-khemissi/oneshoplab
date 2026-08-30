import { handleShopifyWebhook } from '@/features/shopify-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public, HMAC-verified (docs/api/SHOPIFY-CONNECTOR.md). Single product → inline work. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const rawBody = await req.text();
  const outcome = await handleShopifyWebhook({ projectId, rawBody, headers: req.headers });
  return Response.json(outcome.body, { status: outcome.status });
}
