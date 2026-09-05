/**
 * Every generation must survive a refresh.
 *
 * The job row is the truth; the client's transition is a convenience that dies
 * with the tab. Images and the three text fields already resumed with their
 * real elapsed time — alt texts and rounds of angles did not, so pressing F5
 * mid-generation showed a button that had forgotten it was pressed, on work
 * the merchant had already paid for.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadRecentChatJobs } from '@/views/dashboard-product/api/recent-chat-jobs';
import { db } from '@/shared/db';
import { jobs, type JobKind, type JobStatus } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let projectId: string;
let productId: string;

beforeEach(async () => {
  await resetTables();
  const userId = await createUser();
  projectId = await createProject(userId);
  productId = (await createProduct(projectId, { sourceId: 'p1' })).id;
});
afterAll(async () => {
  await db.$client.end();
});

async function job(
  kind: JobKind,
  status: JobStatus,
  startedAt: Date,
  inputPayload: Record<string, unknown> = {}
) {
  await db.insert(jobs).values({
    id: randomUUID(),
    projectId,
    productId,
    kind,
    status,
    startedAt,
    inputPayload
  });
}

describe('what the product page resumes after a refresh', () => {
  it('an alt text being written comes back with the photo it describes', async () => {
    const startedAt = new Date(Date.now() - 4000);
    await job('kie_alt_text', 'running', startedAt, { imageSrc: 'https://cdn.test/2.jpg' });

    const { inFlightAlts } = await loadRecentChatJobs(productId);
    expect(inFlightAlts).toHaveLength(1);
    expect(inFlightAlts[0].imageSrc).toBe('https://cdn.test/2.jpg');
    // DATETIME keeps whole seconds, which is also the precision the counter
    // shows — so "resumed with its real elapsed time" means to the second.
    expect(Math.abs(inFlightAlts[0].startedAtMs - startedAt.getTime())).toBeLessThan(1000);
  });

  it('a round of angles being generated comes back with its start time', async () => {
    const startedAt = new Date(Date.now() - 2000);
    await job('kie_prompt_suggest', 'running', startedAt);

    const { inFlightSuggestionStartedAtMs } = await loadRecentChatJobs(productId);
    expect(inFlightSuggestionStartedAtMs).not.toBeNull();
    expect(Math.abs(inFlightSuggestionStartedAtMs! - startedAt.getTime())).toBeLessThan(1000);
  });

  it('the three text fields still resume, one entry each', async () => {
    const startedAt = new Date(Date.now() - 1000);
    await job('kie_title', 'running', startedAt);
    await job('kie_description', 'running', startedAt);

    const { inFlightChatJobs } = await loadRecentChatJobs(productId);
    expect(inFlightChatJobs.map((j) => j.field).sort()).toEqual(['description', 'title']);
  });

  it('a finished generation is not resumed', async () => {
    await job('kie_alt_text', 'completed', new Date(Date.now() - 3000), {
      imageSrc: 'https://cdn.test/2.jpg'
    });
    await job('kie_prompt_suggest', 'completed', new Date(Date.now() - 3000));

    const res = await loadRecentChatJobs(productId);
    expect(res.inFlightAlts).toHaveLength(0);
    expect(res.inFlightSuggestionStartedAtMs).toBeNull();
  });

  it('an abandoned job stops being resumed instead of spinning forever', async () => {
    // A process killed mid-call leaves the row `running`. Past the recent
    // window the page must not keep showing a timer nobody will ever finish.
    await job('kie_alt_text', 'running', new Date(Date.now() - 10 * 60 * 1000), {
      imageSrc: 'https://cdn.test/2.jpg'
    });

    expect((await loadRecentChatJobs(productId)).inFlightAlts).toHaveLength(0);
  });
});
