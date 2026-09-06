import type { ImageOp } from '@/entities/product-change/client';
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

// ============================================================================
// "Changes waiting for your store" — the banner + its recap modal
// ============================================================================

/** The three statuses a merchant still has to do something about. */
export type PendingChangeStatus = Extract<ProductChangeStatus, 'pending' | 'conflict' | 'failed'>;

export interface PendingCounts {
  total: number;
  pending: number;
  conflict: number;
  failed: number;
}

/**
 * What the modal shows about one change, in the merchant's own words. Images
 * carry their ops rather than a value: only the client knows how to name a
 * photo ("Photo 3"), so `describeOp` runs there.
 */
export type PendingChangeDetail =
  | { kind: 'text'; before: string | null; after: string | null }
  | { kind: 'imageOps'; ops: ImageOp[]; prior: Array<{ ref: string; src: string }> }
  | { kind: 'imageReplaceAll'; before: number; after: number };

export interface PendingChangeItem {
  id: string;
  projectId: string;
  productId: string;
  productTitle: string;
  field: ProductChangeField;
  status: PendingChangeStatus;
  approvedAtIso: string;
  /** Plugin/connector-reported reason when the change failed. */
  error: string | null;
  /** A change born from a generation can be sent again; an image-editor
   *  queue or a reverse change cannot (there is no job to replay). */
  retryable: boolean;
  detail: PendingChangeDetail;
}

export interface PendingSummary {
  counts: PendingCounts;
  items: PendingChangeItem[];
}

/** One site's counter, for the dashboard-home cards. */
export interface PendingSiteCount extends PendingCounts {
  projectId: string;
  projectName: string;
}

export interface PendingUserSummary extends PendingSummary {
  sites: PendingSiteCount[];
}

/**
 * Outcome of "Apply the selection": a change that is (or has just become)
 * pending is on its way to the store; the other two could not be re-sent and
 * still need the merchant.
 */
export interface ApplySelectionCounts {
  queued: number;
  conflict: number;
  failed: number;
}

export type ApplySelectionResult =
  | ({ ok: true } & ApplySelectionCounts)
  | { ok: false; error: 'unauthorized' | 'bad_request' | 'not_found' };

export type ApproveResult =
  /** `projectId` lets the caller revalidate once for a whole batch. */
  | { ok: true; change: ChangeSummary; projectId?: string }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'unsupported'
        | 'invalid_value'
        /** No store can receive it: nothing was queued. */
        | 'not_connected';
    };

/**
 * The image editor's "Appliquer" (docs/api/IMAGE-OPS.md §4). Every reason is
 * one the merchant can act on: `stale` = the gallery moved since the page
 * loaded (reload and look again), `unsupported` = the connection never
 * declared that verb, `last_image` = the product would end up with none.
 */
export type ImageOpsResult =
  | { ok: true; change: ChangeSummary }
  | { ok: false; error: 'too_many_images'; max: number }
  | {
      ok: false;
      error:
        | 'unauthorized'
        | 'bad_request'
        | 'not_found'
        | 'archived'
        | 'unsupported'
        | 'stale'
        | 'last_image';
    };

/**
 * "Générer le texte alternatif" on one tile. Structural on purpose: the
 * generation lives in `features/generate-alt-text` and a feature never imports
 * another feature — the page wires its server action in (see
 * `views/dashboard-product`). Absent = the button is not offered.
 */
export type AltTextGenerator = (
  productId: string,
  src: string
) => Promise<
  | {
      ok: true;
      alt: string;
      creditsConsumed: number;
      /** The server already queued the `set_alt`. The editor must NOT queue a
       *  second, local copy — that duplicate is what left "1 photo edit ready
       *  to send" hanging after the photo had already reached the store. */
      changeQueued?: boolean;
    }
  | { ok: false; error: string }
>;

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
