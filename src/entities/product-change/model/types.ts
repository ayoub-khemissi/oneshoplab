import type { productChanges, ProductChangeField } from '@/shared/db/schema';
import type { ImageValueRejection } from '../lib/image-ops';

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
  | { ok: true; change: ProductChangeRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_value'; rejection: ImageValueRejection };

export interface AckChangeInput {
  status: AckStatus;
  error?: string;
  storeUpdatedAt?: string;
  storeValueHash?: string;
  /** Ops the executor could not carry out, `"<index>:<verb>"` (IMAGE-OPS §2). */
  skippedOps?: string[];
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

/** `dismissChange`: only a failed / conflict row can be dismissed. */
export type DismissChangeResult = 'dismissed' | 'not_found' | 'refused';

/**
 * "Annuler" on an applied change. `conflict` = the product moved in the store
 * since (OSL's copy matches neither what we wrote nor what was there before),
 * so restoring blindly would overwrite the merchant's own edit.
 */
export type ReverseChangeResult =
  | { ok: true; change: ProductChangeRow }
  | {
      ok: false;
      reason: 'not_found' | 'not_applied' | 'no_prior' | 'not_reversible' | 'conflict';
    };
