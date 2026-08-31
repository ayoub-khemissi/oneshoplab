import type { ProductChangeField, ProductChangeStatus } from '@/shared/db/schema';

/** What the product page needs to render one generation's Apply button. */
export interface ChangeSummary {
  id: string;
  status: ProductChangeStatus;
  /** Plugin-reported reason when status is `failed`. */
  error: string | null;
  approvedAtIso: string;
}

export interface PendingChangeSummary extends ChangeSummary {
  productId: string;
  productTitle: string;
  field: ProductChangeField;
}

export type ApproveResult =
  | { ok: true; change: ChangeSummary }
  | {
      ok: false;
      error: 'unauthorized' | 'bad_request' | 'not_found' | 'unsupported' | 'invalid_value';
    };

/** "Annuler" on an applied change → a reverse change (docs/api/IMAGE-OPS.md §3). */
export type UndoResult =
  | { ok: true; change: ChangeSummary }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'not_applied'
        | 'no_prior'
        | 'not_reversible'
        | 'conflict';
    };
