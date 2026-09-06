/**
 * The site page used to stack four cards that all talk about the same subject.
 * They collapse into one line, so the only thing that matters here is the
 * order: the line must never ask for an action while something is still moving.
 */
import { describe, expect, it } from 'vitest';
import { resolveSiteStatus, type SiteStatusInput } from '@/widgets/site-status-line/lib/resolve';

function input(over: Partial<SiteStatusInput> = {}): SiteStatusInput {
  return {
    auditStatus: 'completed',
    catalogArriving: false,
    connected: true,
    applied: true,
    pending: 0,
    toReview: 0,
    manual: false,
    ...over
  };
}

describe('resolveSiteStatus', () => {
  it('says nothing when a connected store has nothing in flight', () => {
    expect(resolveSiteStatus(input())).toBeNull();
  });

  it('puts work in progress before anything it could ask of the merchant', () => {
    // Every lower-priority message is also true here; none of them wins.
    const busy = input({
      auditStatus: 'running',
      catalogArriving: true,
      connected: false,
      applied: false,
      pending: 2,
      toReview: 3
    });
    expect(resolveSiteStatus(busy)?.kind).toBe('auditRunning');
    expect(resolveSiteStatus({ ...busy, auditStatus: 'completed' })?.kind).toBe('catalogArriving');
  });

  it('reports a failure only on a store that is connected', () => {
    // On an unconnected store the connect card owns that moment; repeating it
    // here is what made the page feel broken.
    expect(resolveSiteStatus(input({ auditStatus: 'failed', connected: false }))?.kind).toBe(
      'connectStore'
    );
    expect(resolveSiteStatus(input({ auditStatus: 'failed', connected: true }))?.kind).toBe(
      'auditFailed'
    );
  });

  it('ranks changes needing a decision above changes still travelling', () => {
    expect(resolveSiteStatus(input({ pending: 2, toReview: 1 }))).toMatchObject({
      kind: 'changesToReview',
      count: 1,
      tone: 'danger'
    });
    expect(resolveSiteStatus(input({ pending: 2 }))).toMatchObject({
      kind: 'changesSending',
      count: 2
    });
  });

  it('falls back to the next onboarding step, and only then', () => {
    expect(resolveSiteStatus(input({ connected: false, applied: false }))).toMatchObject({
      kind: 'connectStore',
      target: 'integrations'
    });
    expect(resolveSiteStatus(input({ applied: false }))).toMatchObject({
      kind: 'applyFirstChange',
      target: 'products'
    });
  });

  it('a manual catalogue only ever hears about its changes', () => {
    // Nothing to fetch and nothing to connect: the audit and onboarding
    // messages would be nonsense there.
    expect(resolveSiteStatus(input({ manual: true, connected: false, applied: false }))).toBeNull();
    expect(resolveSiteStatus(input({ manual: true, auditStatus: 'failed' }))).toBeNull();
    expect(resolveSiteStatus(input({ manual: true, toReview: 4 }))?.kind).toBe('changesToReview');
  });
});

describe('a store nobody is connected to', () => {
  const disconnected = {
    auditStatus: 'completed' as const,
    catalogArriving: false,
    connected: false,
    applied: false,
    manual: false
  };

  it('says nothing about changes it cannot send', () => {
    // Rows can outlive the connection that made them — a merchant who removed
    // their plugin still has `pending` in the table. Talking about a delivery
    // that can no longer happen is worse than saying nothing.
    expect(resolveSiteStatus({ ...disconnected, pending: 4, toReview: 0 })?.kind).toBe(
      'connectStore'
    );
    expect(resolveSiteStatus({ ...disconnected, pending: 0, toReview: 2 })?.kind).toBe(
      'connectStore'
    );
  });

  it('still reports them the moment a store is connected', () => {
    expect(
      resolveSiteStatus({ ...disconnected, connected: true, pending: 0, toReview: 2 })?.kind
    ).toBe('changesToReview');
    expect(
      resolveSiteStatus({ ...disconnected, connected: true, pending: 4, toReview: 0 })?.kind
    ).toBe('changesSending');
  });

  it('a manual catalogue is not a disconnected store', () => {
    // It has no store to connect at all, and its changes apply to OneShopLab
    // itself — so they are still its business.
    expect(
      resolveSiteStatus({ ...disconnected, manual: true, pending: 0, toReview: 3 })?.kind
    ).toBe('changesToReview');
  });
});
