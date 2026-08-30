/**
 * Image retention is a product commitment: generated images live in R2 for
 * the plan's window (free shortest), then are deleted and the job row is
 * tombstoned (expiredAt, URLs cleared) — EXCEPT for projects featured on the
 * home showcase, which never expire. R2 itself is stubbed.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteByKey = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/storage', () => ({
  deleteByKey: (k: string) => deleteByKey(k),
  keyFromPublicUrl: (url: string) => new URL(url).pathname.slice(1)
}));

import { imageRetentionDaysForPlan, MAX_IMAGE_RETENTION_DAYS } from '@/entities/ai-model';
import { db } from '@/lib/db';
import { jobs, users } from '@/lib/db/schema';
import { runR2Cleanup } from '@/worker/r2-cleanup';
import { createUser, resetTables } from './helpers';
import { createProject, createShareLink } from './site-helpers';

const DAY = 86_400_000;

async function imageJob(projectId: string, ageDays: number, name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    projectId,
    kind: 'kie_image_generate',
    status: 'completed',
    createdAt: new Date(Date.now() - ageDays * DAY),
    result: {
      persistedUrls: [`https://cdn.oneshoplab.com/kie/${name}.jpg`],
      resultUrls: [`https://cdn.oneshoplab.com/kie/${name}.jpg`]
    }
  });
  return id;
}
const row = (id: string) => db.query.jobs.findFirst({ where: eq(jobs.id, id) });

beforeEach(async () => {
  await resetTables();
  deleteByKey.mockClear();
});
afterAll(async () => {
  await db.$client.end();
});

describe('retention windows', () => {
  it('free is the shortest window, paid plans keep images longer, unknown plan = free', () => {
    const free = imageRetentionDaysForPlan('free');
    expect(free).toBeGreaterThan(0);
    for (const plan of ['starter', 'pro', 'scale']) {
      expect(imageRetentionDaysForPlan(plan)).toBeGreaterThanOrEqual(free);
    }
    expect(imageRetentionDaysForPlan('bogus')).toBe(free);
    expect(imageRetentionDaysForPlan(null)).toBe(free);
    expect(MAX_IMAGE_RETENTION_DAYS).toBe(imageRetentionDaysForPlan('scale'));
  });
});

describe('runR2Cleanup', () => {
  it('expires only images past the owner plan window, deletes R2 objects, tombstones the row', async () => {
    const freeUser = await createUser();
    const scaleUser = await createUser();
    await db.update(users).set({ plan: 'scale' }).where(eq(users.id, scaleUser));
    const freeSite = await createProject(freeUser);
    const scaleSite = await createProject(scaleUser);
    const freeDays = imageRetentionDaysForPlan('free');
    const scaleDays = imageRetentionDaysForPlan('scale');

    const freeOld = await imageJob(freeSite, Math.max(freeDays, 30) + 2, 'free-old');
    const freeFresh = await imageJob(freeSite, 1, 'free-fresh');
    const scaleMid = await imageJob(scaleSite, Math.max(freeDays, 30) + 2, 'scale-mid');
    const scaleOld = await imageJob(scaleSite, scaleDays + 2, 'scale-old');

    const res = await runR2Cleanup();
    expect(res).toEqual({ deleted: 2, r2Objects: 2 });
    expect(deleteByKey.mock.calls.map((c) => c[0]).sort()).toEqual([
      'kie/free-old.jpg',
      'kie/scale-old.jpg'
    ]);

    const expired = (await row(freeOld))!;
    expect(expired.expiredAt).toBeInstanceOf(Date);
    expect(expired.result).toEqual({ persistedUrls: [], resultUrls: [] });
    expect((await row(freeFresh))!.expiredAt).toBeNull();
    expect((await row(scaleMid))!.expiredAt).toBeNull();
    expect((await row(scaleOld))!.expiredAt).toBeInstanceOf(Date);

    // Idempotent: a second tick has nothing left to do.
    expect(await runR2Cleanup()).toEqual({ deleted: 0, r2Objects: 0 });
  });

  it('NEVER expires images of a project featured on the home showcase', async () => {
    const user = await createUser();
    const featured = await createProject(user);
    const plain = await createProject(user);
    await createShareLink(user, featured, { showOnHome: true });
    const revokedSite = await createProject(user);
    await createShareLink(user, revokedSite, { showOnHome: true, revoked: true });

    const keep = await imageJob(featured, 400, 'featured');
    const gone = await imageJob(plain, 400, 'plain');
    const goneToo = await imageJob(revokedSite, 400, 'revoked-showcase');

    const res = await runR2Cleanup();
    expect(res.deleted).toBe(2);
    expect((await row(keep))!.expiredAt).toBeNull();
    expect((await row(keep))!.result).toMatchObject({
      persistedUrls: ['https://cdn.oneshoplab.com/kie/featured.jpg']
    });
    expect((await row(gone))!.expiredAt).toBeInstanceOf(Date);
    expect((await row(goneToo))!.expiredAt).toBeInstanceOf(Date);
    expect(deleteByKey).not.toHaveBeenCalledWith('kie/featured.jpg');
  });

  it('orphan jobs (no project) fall back to the free window', async () => {
    const orphan = await imageJob(null as unknown as string, 400, 'orphan');
    await runR2Cleanup();
    expect((await row(orphan))!.expiredAt).toBeInstanceOf(Date);
  });
});
