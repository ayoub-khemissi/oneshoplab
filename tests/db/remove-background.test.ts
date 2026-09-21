/**
 * Background removal against the real database: the credit hold, the job
 * row every image consumer reads, the refund when kie refuses the task, and
 * the grid's reading of a cut-out. kie is stubbed at the provider entity.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const kie = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; input: Record<string, unknown> }>,
  fail: false
}));
vi.mock('@/entities/ai-provider', () => ({
  buildKieCallbackUrl: () => undefined,
  getKieClient: () => ({
    createTask: async (opts: { model: string; input: Record<string, unknown> }) => {
      kie.calls.push(opts);
      if (kie.fail) throw new Error('kie createTask failed: bad image');
      return { taskId: `task-${kie.calls.length}` };
    }
  }),
  isImageFallbackConfigured: () => false,
  generateFallbackImage: async () => {
    throw new Error('not configured');
  }
}));

import { costForRemoveBackground } from '@/entities/ai-model';
import { listProductImageJobs, startRemoveBackground } from '@/entities/generation-job';
import { InsufficientCreditsError } from '@/entities/credit';
import { db } from '@/shared/db';
import { jobs, users } from '@/shared/db/schema';
import { createUser, ledgerSum, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;
const SOURCE = 'p1';
const IMAGE = 'https://cdn.oneshoplab.com/kie/src-job/pic.png';

beforeEach(async () => {
  await resetTables();
  kie.calls = [];
  kie.fail = false;
  userId = await createUser({ pack: 50 });
  projectId = await createProject(userId);
  await createProduct(projectId, { sourceId: SOURCE });
});
afterAll(async () => {
  await db.$client.end();
});

async function balance(): Promise<number> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return u!.creditsBalance;
}

describe('startRemoveBackground', () => {
  it('holds the cut-out price, records a kie_image_edit row tagged remove_bg and calls Recraft', async () => {
    const cost = costForRemoveBackground();
    const r = await startRemoveBackground({
      userId,
      projectId,
      productSourceId: SOURCE,
      sourceImageUrl: IMAGE,
      sourceJobId: 'src-job',
      sourceAlt: 'Red jar of hair wax'
    });
    expect(r.creditsHeld).toBe(cost);
    expect(await balance()).toBe(50 - cost);
    expect(await ledgerSum(userId)).toBe(50 - cost);

    expect(kie.calls).toEqual([{ model: 'recraft/remove-background', input: { image: IMAGE } }]);

    const row = await db.query.jobs.findFirst({ where: eq(jobs.id, r.jobId) });
    expect(row?.kind).toBe('kie_image_edit');
    expect(row?.status).toBe('running');
    expect(row?.kieTaskId).toBe('task-1');
    expect(row?.creditsCost).toBe(cost);
    expect(row?.inputPayload).toMatchObject({
      op: 'remove_bg',
      productSourceId: SOURCE,
      sourceImageUrl: IMAGE,
      sourceJobId: 'src-job',
      sourceAlt: 'Red jar of hair wax'
    });

    // The grid sees it as a pending image of the product, flagged as derived.
    const visible = await listProductImageJobs(projectId, SOURCE);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ derived: 'remove_bg', sourceJobId: 'src-job' });
  });

  it('fails the job and refunds when kie refuses the task', async () => {
    kie.fail = true;
    await expect(
      startRemoveBackground({ userId, projectId, productSourceId: SOURCE, sourceImageUrl: IMAGE })
    ).rejects.toThrow('kie createTask failed');
    expect(await balance()).toBe(50);
    expect(await ledgerSum(userId)).toBe(50);
    const rows = await db.query.jobs.findMany({ where: eq(jobs.projectId, projectId) });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
  });

  it('refuses without a job row when the balance is short', async () => {
    await db.update(users).set({ creditsBalance: 1 }).where(eq(users.id, userId));
    await expect(
      startRemoveBackground({ userId, projectId, productSourceId: SOURCE, sourceImageUrl: IMAGE })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(kie.calls).toHaveLength(0);
    expect(await db.query.jobs.findMany({ where: eq(jobs.projectId, projectId) })).toHaveLength(0);
  });
});
