import { DEFAULT_BUCKET, withSiteKey } from '@/entities/api-key';
import { describeSite } from '@/features/catalog-sync';
import { jsonResponse } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSiteKey(async (_req, ctx) => jsonResponse(await describeSite(ctx)), {
  bucket: DEFAULT_BUCKET
});
