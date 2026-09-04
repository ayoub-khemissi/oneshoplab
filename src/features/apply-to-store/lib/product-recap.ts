import type { ProductChangeStatus } from '@/shared/db/schema';

/**
 * "Where do my generations stand on this product?" — the one question the page
 * could not answer.
 *
 * A generation only enters the store-side counters once the merchant clicks
 * Apply, so anything generated and not applied was invisible everywhere: the
 * banner counts what is already on its way, the photo panel counts staged photo
 * edits, and neither mentions a rewritten set of tags sitting there unused.
 */

/** Fields a recap row can describe. Images have their own editor. */
export const RECAP_FIELDS = ['title', 'description', 'tags'] as const;
export type RecapField = (typeof RECAP_FIELDS)[number];

/**
 * What the merchant sees per field, in the order of who is waiting on whom:
 * `to_apply` waits on them, `sending` on the store, `applied` on no one.
 */
export type RecapState = 'to_apply' | 'sending' | 'applied' | 'conflict' | 'failed';

export interface RecapRow {
  field: RecapField;
  state: RecapState;
  /** The generation this row is about — the Apply button acts on it. */
  jobId: string;
  /** When the change reached its current state; null while never applied. */
  atIso: string | null;
}

export interface RecapInput {
  field: RecapField;
  /** Newest generation for that field, if any. */
  jobId: string | null;
  change: { status: ProductChangeStatus; approvedAtIso: string } | null;
}

/**
 * A settled-but-not-applied change (cancelled, expired, skipped) leaves the
 * generation available again — the merchant can send it a second time, so the
 * row reads `to_apply` rather than advertising a status they did not choose.
 */
function stateOf(status: ProductChangeStatus): RecapState {
  switch (status) {
    case 'pending':
      return 'sending';
    case 'applied':
      return 'applied';
    case 'conflict':
      return 'conflict';
    case 'failed':
      return 'failed';
    default:
      return 'to_apply';
  }
}

export function buildProductRecap(inputs: readonly RecapInput[]): RecapRow[] {
  const rows: RecapRow[] = [];
  for (const input of inputs) {
    // No generation for that field: nothing to say. The field's own panel
    // already invites them to generate one.
    if (!input.jobId) continue;
    const state = input.change ? stateOf(input.change.status) : 'to_apply';
    rows.push({
      field: input.field,
      state,
      jobId: input.jobId,
      atIso: state === 'to_apply' ? null : (input.change?.approvedAtIso ?? null)
    });
  }
  return rows;
}

/** How many generations are waiting on the merchant's own decision. */
export function countToApply(rows: readonly RecapRow[]): number {
  return rows.filter((r) => r.state === 'to_apply').length;
}

/** True while the store still has something to confirm. */
export function hasSending(rows: readonly RecapRow[]): boolean {
  return rows.some((r) => r.state === 'sending');
}
