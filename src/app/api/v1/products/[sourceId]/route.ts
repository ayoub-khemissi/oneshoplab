import { DEFAULT_BUCKET, withSiteKey } from '@/entities/api-key';
import { archiveCatalogProduct } from '@/features/catalog-sync';
import { jsonResponse } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sourceId: string }> }
): Promise<Response> {
  const { sourceId } = await params;
  return withSiteKey(
    async (_req, ctx) => jsonResponse(await archiveCatalogProduct(ctx.project.id, sourceId)),
    { permission: 'catalog:write', bucket: DEFAULT_BUCKET }
  )(req);
}
