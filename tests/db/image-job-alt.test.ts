/**
 * The alt travels with its image.
 *
 * `costForImage` bills the picture and its alt as one purchase, and the worker
 * writes the alt onto the job's own result. The product page then dropped it:
 * the row it builds for the editor carried `alt: null`, so a photo whose alt
 * had already been generated and paid for was shown as "no alternative text",
 * next to a button offering to write one for another credit.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listProductImageJobs } from '@/entities/generation-job';
import { db } from '@/shared/db';
import { jobs } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let projectId: string;
const SOURCE = 'p1';

beforeEach(async () => {
  await resetTables();
  const userId = await createUser();
  projectId = await createProject(userId);
  await createProduct(projectId, { sourceId: SOURCE });
});
afterAll(async () => {
  await db.$client.end();
});

async function imageJob(result: Record<string, unknown>) {
  await db.insert(jobs).values({
    id: randomUUID(),
    projectId,
    kind: 'kie_image_edit',
    status: 'completed',
    inputPayload: { productSourceId: SOURCE },
    result
  });
}

describe('listProductImageJobs', () => {
  it('carries the alt the worker wrote for the image', async () => {
    await imageJob({
      persistedUrls: ['https://cdn.test/gen.jpg'],
      alts: ['Coussin en lin ocre posé sur un banc de bois']
    });

    const [row] = await listProductImageJobs(projectId, SOURCE);
    expect(row.imageUrl).toBe('https://cdn.test/gen.jpg');
    expect(row.alt).toBe('Coussin en lin ocre posé sur un banc de bois');
  });

  it('reports no alt when none was written yet', async () => {
    // The alt pass runs a moment after the image lands; until then the
    // absence is real and the page may offer to write one.
    await imageJob({ persistedUrls: ['https://cdn.test/gen.jpg'] });
    expect((await listProductImageJobs(projectId, SOURCE))[0].alt).toBeNull();
  });

  it('takes the alt of the image it returns, not of another one', async () => {
    await imageJob({
      persistedUrls: ['https://cdn.test/first.jpg', 'https://cdn.test/second.jpg'],
      alts: ['The first one', 'The second one']
    });
    const [row] = await listProductImageJobs(projectId, SOURCE);
    expect(row.imageUrl).toBe('https://cdn.test/first.jpg');
    expect(row.alt).toBe('The first one');
  });

  it('survives a result whose alts the model refused', async () => {
    await imageJob({ persistedUrls: ['https://cdn.test/gen.jpg'], altsFailed: true });
    expect((await listProductImageJobs(projectId, SOURCE))[0].alt).toBeNull();
  });
});
