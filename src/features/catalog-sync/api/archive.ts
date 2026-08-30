import { archiveProductBySourceId } from '@/entities/product';
import { ApiError } from '@/shared/api';

/** `DELETE /api/v1/products/{sourceId}`: archive, idempotent, 404 unknown. */
export async function archiveCatalogProduct(
  projectId: string,
  sourceId: string
): Promise<{ sourceId: string; status: 'archived'; alreadyArchived: boolean }> {
  const res = await archiveProductBySourceId(projectId, sourceId);
  if (res === 'not_found') throw new ApiError('not_found', 'Unknown product', 404);
  return { sourceId, status: 'archived', alreadyArchived: res === 'already_archived' };
}
