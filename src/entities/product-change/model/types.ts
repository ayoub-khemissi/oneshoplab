import type { productChanges, ProductChangeField } from '@/shared/db/schema';

export type ProductChangeRow = typeof productChanges.$inferSelect;
export type AckStatus = 'applied' | 'failed' | 'skipped';

export interface CreateChangeInput {
  projectId: string;
  productId: string;
  productSourceId: string;
  field: ProductChangeField;
  value: unknown;
  sourceJobId?: string | null;
  approvedBy: string;
  expiresAt?: Date | null;
}

export type CreateChangeResult =
  { ok: true; change: ProductChangeRow } | { ok: false; reason: 'not_found' };

export interface AckChangeInput {
  status: AckStatus;
  error?: string;
  storeUpdatedAt?: string;
  storeValueHash?: string;
}

export type AckChangeResult =
  | { kind: 'ok'; change: ProductChangeRow }
  | { kind: 'not_found' }
  | { kind: 'already_acked'; change: ProductChangeRow };

export interface ListPendingOptions {
  /** Cursor: the last change id seen (exclusive). */
  since?: string | null;
  limit?: number;
}

export interface PendingChangesPage {
  changes: ProductChangeRow[];
  nextCursor: string | null;
}

export type CancelChangeResult = 'cancelled' | 'not_found' | 'refused';
