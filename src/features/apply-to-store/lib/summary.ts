import type { ProductChangeRow } from '@/entities/product-change';
import type { ChangeSummary } from '../model/types';

export function toChangeSummary(row: ProductChangeRow): ChangeSummary {
  return {
    id: row.id,
    status: row.status,
    error: row.ackPayload?.error ?? null,
    approvedAtIso: row.approvedAt.toISOString()
  };
}
