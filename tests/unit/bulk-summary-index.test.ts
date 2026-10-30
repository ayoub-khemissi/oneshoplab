/**
 * Bulk worker: the latest audit's summary is indexed once per audit version
 * instead of reloaded and scanned on every pass. The index must answer exactly
 * like the scan it replaced, and the cache must reload only when the latest
 * audit moves. The audit lookup and the DB are stubbed — no MySQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findStamp, findAudit } = vi.hoisted(() => ({ findStamp: vi.fn(), findAudit: vi.fn() }));
vi.mock('@/entities/audit', () => ({ findLatestAuditStampForProject: findStamp }));
vi.mock('@/shared/db', () => ({ db: { query: { audits: { findFirst: findAudit } } } }));

import { forgetSummaryIndex, getSummaryIndex } from '@/features/bulk-generate/api/summary-cache';
import type { SummaryProduct, SummaryShape } from '@/features/bulk-generate/lib/context';
import { buildSummaryIndex, matchSummaryProduct } from '@/features/bulk-generate/lib/summary-index';

type Row = { sourceId: string | null; handle: string | null };

const p = (sourceId: string | null, handle: string | null, title: string): SummaryProduct => ({
  sourceId,
  handle,
  title,
  descriptionHtml: '',
  images: [],
  signals: {}
});

/** The scan processNextBulkProduct ran before the index, verbatim. */
function scan(summary: SummaryShape | null, row: Row): SummaryProduct | null {
  const all: SummaryProduct[] = summary
    ? [
        ...(summary.allProducts ?? []),
        ...(summary.worstProducts ?? []),
        ...(summary.latestProducts ?? []),
        ...(summary.bestProducts ?? [])
      ]
    : [];
  return (
    all.find((x) => {
      if (row.sourceId && x.sourceId === row.sourceId) return true;
      if (row.handle && x.handle === row.handle) return true;
      return false;
    }) ?? null
  );
}

const lookup = (summary: SummaryShape | null, row: Row) =>
  matchSummaryProduct(buildSummaryIndex(summary), row);

describe('matchSummaryProduct', () => {
  it('finds a product by sourceId, then by handle', () => {
    const summary = { allProducts: [p('1', 'a', 'one'), p('2', 'b', 'two')] };
    expect(lookup(summary, { sourceId: '2', handle: null })?.title).toBe('two');
    expect(lookup(summary, { sourceId: null, handle: 'a' })?.title).toBe('one');
    expect(lookup(summary, { sourceId: '9', handle: 'b' })?.title).toBe('two');
    expect(lookup(summary, { sourceId: '9', handle: 'z' })).toBeNull();
  });

  it('returns the first product matching either key, not the sourceId match first', () => {
    const summary = {
      allProducts: [p('other', 'shared-handle', 'handle hit, earlier')],
      worstProducts: [p('42', 'own-handle', 'sourceId hit, later')]
    };
    const row = { sourceId: '42', handle: 'shared-handle' };
    expect(lookup(summary, row)?.title).toBe('handle hit, earlier');
    expect(lookup(summary, row)).toBe(scan(summary, row));
  });

  it('walks allProducts, worstProducts, latestProducts, bestProducts in that order', () => {
    const summary = {
      bestProducts: [p('7', null, 'best')],
      latestProducts: [p('7', null, 'latest')],
      worstProducts: [p('7', null, 'worst')]
    };
    expect(lookup(summary, { sourceId: '7', handle: null })?.title).toBe('worst');
    expect(
      lookup({ ...summary, allProducts: [p('7', null, 'all')] }, { sourceId: '7', handle: null })
        ?.title
    ).toBe('all');
  });

  it('never matches on a missing key', () => {
    const summary = { allProducts: [p(null, null, 'keyless'), p('', '', 'empty keys')] };
    expect(lookup(summary, { sourceId: null, handle: null })).toBeNull();
    expect(lookup(summary, { sourceId: '', handle: '' })).toBeNull();
  });

  it('copes with no summary and missing lists', () => {
    expect(lookup(null, { sourceId: '1', handle: 'a' })).toBeNull();
    expect(lookup({}, { sourceId: '1', handle: 'a' })).toBeNull();
  });

  it('answers like the old scan for every key combination', () => {
    const ids = ['1', '2', '3', null];
    const handles = ['a', 'b', 'c', null];
    const pick = <T>(xs: T[], i: number) => xs[i % xs.length];
    // Overlapping keys across and within lists, deterministic.
    const list = (offset: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        p(pick(ids, i * 3 + offset), pick(handles, i * 5 + offset * 2), `t${offset}-${i}`)
      );
    const summary: SummaryShape = {
      allProducts: list(0, 7),
      worstProducts: list(1, 5),
      latestProducts: list(2, 3),
      bestProducts: list(3, 4)
    };
    const index = buildSummaryIndex(summary);
    for (const sourceId of [...ids, '9', '']) {
      for (const handle of [...handles, 'z', '']) {
        const row = { sourceId, handle };
        expect(matchSummaryProduct(index, row), JSON.stringify(row)).toBe(scan(summary, row));
      }
    }
  });
});

describe('getSummaryIndex', () => {
  const stamp = (id: string, completedAt: Date | null) => ({
    id,
    status: 'completed',
    startedAt: new Date('2026-10-01T10:00:00Z'),
    completedAt
  });
  const t1 = new Date('2026-10-01T10:05:00Z');
  const t2 = new Date('2026-10-01T10:07:00Z');
  const summaryWith = (title: string) => ({ summary: { allProducts: [p('1', 'a', title)] } });
  const row = { sourceId: '1', handle: null };

  beforeEach(() => {
    forgetSummaryIndex();
    findStamp.mockReset();
    findAudit.mockReset();
  });

  it('loads the summary once while the latest audit stays the same', async () => {
    findStamp.mockResolvedValue(stamp('audit-1', t1));
    findAudit.mockResolvedValue(summaryWith('v1'));

    const first = await getSummaryIndex('project-1', 'shop.test');
    const second = await getSummaryIndex('project-1', 'shop.test');

    expect(second).toBe(first);
    expect(findStamp).toHaveBeenCalledTimes(2);
    expect(findAudit).toHaveBeenCalledTimes(1);
    expect(matchSummaryProduct(second, row)?.title).toBe('v1');
  });

  it('reads only the summary column of the latest audit', async () => {
    findStamp.mockResolvedValue(stamp('audit-1', t1));
    findAudit.mockResolvedValue(summaryWith('v1'));

    await getSummaryIndex('project-1', 'shop.test');

    expect(findStamp).toHaveBeenCalledWith('project-1', 'shop.test');
    expect(findAudit.mock.calls[0][0].columns).toEqual({ summary: true });
  });

  it('reloads when a newer audit lands', async () => {
    findStamp
      .mockResolvedValueOnce(stamp('audit-1', t1))
      .mockResolvedValueOnce(stamp('audit-2', t2));
    findAudit.mockResolvedValueOnce(summaryWith('v1')).mockResolvedValueOnce(summaryWith('v2'));

    await getSummaryIndex('project-1', null);
    const index = await getSummaryIndex('project-1', null);

    expect(findAudit).toHaveBeenCalledTimes(2);
    expect(matchSummaryProduct(index, row)?.title).toBe('v2');
  });

  it('reloads when the same audit is re-scored in place', async () => {
    findStamp
      .mockResolvedValueOnce(stamp('audit-1', t1))
      .mockResolvedValueOnce(stamp('audit-1', t2));
    findAudit
      .mockResolvedValueOnce(summaryWith('v1'))
      .mockResolvedValueOnce(summaryWith('rescored'));

    await getSummaryIndex('project-1', null);
    const index = await getSummaryIndex('project-1', null);

    expect(findAudit).toHaveBeenCalledTimes(2);
    expect(matchSummaryProduct(index, row)?.title).toBe('rescored');
  });

  it('keeps one project at a time', async () => {
    findStamp.mockResolvedValue(stamp('audit-1', t1));
    findAudit.mockResolvedValue(summaryWith('v1'));

    await getSummaryIndex('project-1', null);
    await getSummaryIndex('project-2', null);
    await getSummaryIndex('project-1', null);

    expect(findAudit).toHaveBeenCalledTimes(3);
  });

  it('forgets the index once no bulk is in flight', async () => {
    findStamp.mockResolvedValue(stamp('audit-1', t1));
    findAudit.mockResolvedValue(summaryWith('v1'));

    await getSummaryIndex('project-1', null);
    forgetSummaryIndex();
    await getSummaryIndex('project-1', null);

    expect(findAudit).toHaveBeenCalledTimes(2);
  });

  it('serves an empty index, without a summary read, when the project has no audit', async () => {
    findStamp.mockResolvedValue(null);

    const index = await getSummaryIndex('project-1', null);

    expect(findAudit).not.toHaveBeenCalled();
    expect(matchSummaryProduct(index, row)).toBeNull();
  });
});
