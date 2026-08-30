import { handleWixWebhook } from '@/features/wix-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public, JWT-verified (docs/api/WIX-CONNECTOR.md). Body is the raw JWT (text/plain). */
export async function POST(req: Request): Promise<Response> {
  const outcome = await handleWixWebhook(await req.text());
  return Response.json(outcome.body, { status: outcome.status });
}
