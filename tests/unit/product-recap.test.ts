/**
 * The recap answers "where do my generations stand on this product?" — the
 * question no counter on the page could answer, because a generation only
 * enters the store-side numbers once the merchant has clicked Apply.
 */
import { describe, expect, it } from 'vitest';
import {
  buildProductRecap,
  countToApply,
  hasSending,
  type RecapInput
} from '@/features/apply-to-store/lib/product-recap';

const AT = '2026-09-04T10:37:36.000Z';

function input(over: Partial<RecapInput> = {}): RecapInput {
  return { field: 'tags', jobId: 'job-1', change: null, ...over };
}

describe('buildProductRecap', () => {
  it('a generation nobody applied is waiting on the merchant', () => {
    const [row] = buildProductRecap([input()]);
    expect(row.state).toBe('to_apply');
    expect(row.atIso).toBeNull();
    expect(countToApply([row])).toBe(1);
  });

  it('maps each change status to who is waiting', () => {
    const state = (status: RecapInput['change'] extends null ? never : string) =>
      buildProductRecap([input({ change: { status: status as 'pending', approvedAtIso: AT } })])[0]
        .state;

    expect(state('pending')).toBe('sending');
    expect(state('applied')).toBe('applied');
    expect(state('conflict')).toBe('conflict');
    expect(state('failed')).toBe('failed');
  });

  it('a cancelled or expired change hands the generation back to the merchant', () => {
    for (const status of ['cancelled', 'expired', 'skipped'] as const) {
      const [row] = buildProductRecap([input({ change: { status, approvedAtIso: AT } })]);
      // They never chose this outcome, so the row invites them to send it
      // again rather than reporting a status they did not ask for.
      expect(row.state).toBe('to_apply');
      expect(row.atIso).toBeNull();
    }
  });

  it('says nothing about a field that was never generated', () => {
    expect(buildProductRecap([input({ jobId: null })])).toHaveLength(0);
  });

  it('reports the store still owes an answer only while something is pending', () => {
    const rows = buildProductRecap([
      input({ field: 'title', change: { status: 'applied', approvedAtIso: AT } }),
      input({ field: 'tags', change: { status: 'pending', approvedAtIso: AT } })
    ]);
    expect(hasSending(rows)).toBe(true);
    expect(countToApply(rows)).toBe(0);
    expect(hasSending(rows.slice(0, 1))).toBe(false);
  });
});
