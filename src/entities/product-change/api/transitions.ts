/**
 * The ONE place that changes `product_changes.status` (same pattern as
 * generation-job): a guarded UPDATE so a late ack cannot overwrite a
 * cancellation and racing acks cannot both win.
 *
 *   pending → applied | failed | skipped | conflict | cancelled | expired
 *   every other status is terminal.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/shared/db';
import { productChanges, type ProductChangeStatus } from '@/shared/db/schema';

export type ChangeDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const TERMINAL_CHANGE_STATUSES: readonly ProductChangeStatus[] = [
  'applied',
  'failed',
  'skipped',
  'conflict',
  'cancelled',
  'expired'
];

/** Allowed *sources* for each target status. */
export const CHANGE_TRANSITIONS: Record<ProductChangeStatus, readonly ProductChangeStatus[]> = {
  pending: [],
  applied: ['pending'],
  failed: ['pending'],
  skipped: ['pending'],
  conflict: ['pending'],
  cancelled: ['pending'],
  expired: ['pending']
};

export function canTransitionChange(from: ProductChangeStatus, to: ProductChangeStatus): boolean {
  return CHANGE_TRANSITIONS[to].includes(from);
}

export class IllegalChangeTransition extends Error {
  constructor(
    public readonly changeId: string,
    public readonly from: ProductChangeStatus,
    public readonly to: ProductChangeStatus
  ) {
    super(`product change ${changeId}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalChangeTransition';
  }
}

export class ChangeNotFound extends Error {
  constructor(public readonly changeId: string) {
    super(`product change ${changeId} not found`);
    this.name = 'ChangeNotFound';
  }
}

type ChangePatch = Partial<Omit<typeof productChanges.$inferInsert, 'id' | 'status'>>;

export type ChangeTransitionResult = 'applied' | 'refused';

export async function transitionChange(
  exec: ChangeDbExecutor,
  changeId: string,
  to: ProductChangeStatus,
  patch: ChangePatch = {},
  opts: { tolerate?: boolean } = {}
): Promise<ChangeTransitionResult> {
  const sources = CHANGE_TRANSITIONS[to];
  if (sources.length === 0) {
    if (opts.tolerate) return 'refused';
    throw new IllegalChangeTransition(changeId, to, to);
  }
  const [res] = await exec
    .update(productChanges)
    .set({ ...patch, status: to })
    .where(and(eq(productChanges.id, changeId), inArray(productChanges.status, [...sources])));
  if (res.affectedRows > 0) return 'applied';
  if (opts.tolerate) return 'refused';

  const [row] = await exec
    .select({ status: productChanges.status })
    .from(productChanges)
    .where(eq(productChanges.id, changeId));
  if (!row) throw new ChangeNotFound(changeId);
  throw new IllegalChangeTransition(changeId, row.status, to);
}
