/**
 * Bulk generation lifecycle (Scale plan): one run per site at a time, cost
 * estimate derived from the catalog, cancel is a guarded transition, retry
 * re-queues only the products that had a failed field.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  costForImage,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  estimateChatCredits
} from '@/lib/ai/models';
import { cancelBulkJob, retryFailedFromBulk, startBulkSiteGenerate } from '@/lib/bulk/lifecycle';
import { estimateBulkCostBreakdown } from '@/lib/bulk/planning';
import { resolveBulkPrefs } from '@/lib/bulk/types';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

const job = (id: string) => db.query.jobs.findFirst({ where: eq(jobs.id, id) });

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('estimateBulkCostBreakdown', () => {
  it('sums the enabled text fields and images × angles, times the product count', () => {
    const prefs = resolveBulkPrefs(null);
    const b = estimateBulkCostBreakdown(10, 'sonnet-5', 'image-2k', prefs);
    const chat =
      (prefs.fields.title ? estimateChatCredits('sonnet-5', 'title') : 0) +
      (prefs.fields.description ? estimateChatCredits('sonnet-5', 'description') : 0) +
      (prefs.fields.tags ? estimateChatCredits('sonnet-5', 'tags') : 0);
    const images = prefs.fields.images ? costForImage('image-2k') * prefs.imageAngles.length : 0;
    expect(b.perProduct).toEqual({ chat, images, total: chat + images });
    expect(b.total).toBe((chat + images) * 10);

    const textOnly = resolveBulkPrefs({
      fields: { ...prefs.fields, images: false },
      imageAngles: prefs.imageAngles
    });
    expect(estimateBulkCostBreakdown(1, 'sonnet-5', 'image-2k', textOnly).perProduct.images).toBe(
      0
    );
  });
});

describe('startBulkSiteGenerate / cancelBulkJob', () => {
  it('queues one pending job per site, refuses a second while one is live, falls back to default models', async () => {
    const user = await createUser();
    const site = await createProject(user);
    const res = await startBulkSiteGenerate({
      projectId: site,
      productIds: ['p1', 'p2'],
      chatModelId: 'not-a-model' as never,
      imageQualityId: 'bogus' as never,
      totalCreditsBudget: 500
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = (await job(res.jobId))!;
    expect(row).toMatchObject({ kind: 'bulk_site_generate', status: 'pending', projectId: site });
    expect(row.inputPayload).toMatchObject({
      productIds: ['p1', 'p2'],
      chatModelId: DEFAULT_CHAT_MODEL,
      imageQualityId: DEFAULT_IMAGE_QUALITY
    });
    expect(row.result).toMatchObject({ total: 2, totalCreditsBudget: 500, perProduct: {} });

    expect(
      await startBulkSiteGenerate({ projectId: site, productIds: ['p3'], totalCreditsBudget: 1 })
    ).toEqual({
      ok: false,
      reason: 'already_running'
    });
    // Another site is independent.
    const other = await createProject(user);
    expect(
      (await startBulkSiteGenerate({ projectId: other, productIds: ['x'], totalCreditsBudget: 1 }))
        .ok
    ).toBe(true);
  });

  it('cancel is owner-scoped, marks the job failed/cancelled_by_user, and is idempotent', async () => {
    const user = await createUser();
    const site = await createProject(user);
    const otherSite = await createProject(user);
    const res = await startBulkSiteGenerate({
      projectId: site,
      productIds: ['p1'],
      totalCreditsBudget: 10
    });
    if (!res.ok) throw new Error('start failed');

    expect(await cancelBulkJob(res.jobId, otherSite)).toBe(true);
    expect((await job(res.jobId))!.status).toBe('pending');

    expect(await cancelBulkJob(res.jobId, site)).toBe(true);
    const cancelled = (await job(res.jobId))!;
    expect(cancelled.status).toBe('failed');
    expect(cancelled.error).toBe('cancelled_by_user');
    expect(cancelled.finishedAt).toBeInstanceOf(Date);

    expect(await cancelBulkJob(res.jobId, site)).toBe(true);
    // The site is free again.
    expect(
      (await startBulkSiteGenerate({ projectId: site, productIds: ['p1'], totalCreditsBudget: 10 }))
        .ok
    ).toBe(true);
  });
});

describe('retryFailedFromBulk', () => {
  it('re-queues only products with a failed field, keeping the source prefs', async () => {
    const user = await createUser();
    const site = await createProject(user);
    const prefs = resolveBulkPrefs({
      fields: { title: true, description: false, tags: false, images: true },
      imageAngles: ['studio']
    });
    const first = await startBulkSiteGenerate({
      projectId: site,
      productIds: ['p1', 'p2', 'p3'],
      totalCreditsBudget: 100,
      prefs
    });
    if (!first.ok) throw new Error('start failed');

    // Failed fields recorded while the run is still live → refused because a
    // bulk is already running for the site (failure detection comes first).
    const failedResult = {
      total: 3,
      totalCreditsBudget: 100,
      lastProgressAtMs: null,
      perProduct: {
        p1: { fields: { title: 'done', images: 'done' } },
        p2: { fields: { title: 'done', images: { error: 'insufficient_credits' } } },
        p3: { fields: { title: { error: 'kie_failed' } } }
      }
    };
    await db.update(jobs).set({ result: failedResult }).where(eq(jobs.id, first.jobId));
    expect(
      await retryFailedFromBulk({
        projectId: site,
        sourceJobId: first.jobId,
        totalCreditsBudget: 1
      })
    ).toEqual({ ok: false, reason: 'already_running' });
    await db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, first.jobId));

    const retry = await retryFailedFromBulk({
      projectId: site,
      sourceJobId: first.jobId,
      totalCreditsBudget: 50
    });
    expect(retry).toMatchObject({ ok: true, productCount: 2 });
    if (!retry.ok) return;
    const row = (await job(retry.jobId))!;
    expect(row.inputPayload).toMatchObject({
      productIds: ['p2', 'p3'],
      fields: prefs.fields,
      imageAngles: prefs.imageAngles
    });

    expect(
      await retryFailedFromBulk({ projectId: site, sourceJobId: 'nope', totalCreditsBudget: 1 })
    ).toEqual({
      ok: false,
      reason: 'source_not_found'
    });
  });

  it('reports no_failures when every field succeeded', async () => {
    const user = await createUser();
    const site = await createProject(user);
    const first = await startBulkSiteGenerate({
      projectId: site,
      productIds: ['p1'],
      totalCreditsBudget: 10
    });
    if (!first.ok) throw new Error('start failed');
    await db
      .update(jobs)
      .set({
        status: 'completed',
        result: {
          total: 1,
          totalCreditsBudget: 10,
          lastProgressAtMs: null,
          perProduct: { p1: { fields: { title: 'done' } } }
        }
      })
      .where(eq(jobs.id, first.jobId));
    expect(
      await retryFailedFromBulk({
        projectId: site,
        sourceJobId: first.jobId,
        totalCreditsBudget: 1
      })
    ).toEqual({
      ok: false,
      reason: 'no_failures'
    });
  });
});
