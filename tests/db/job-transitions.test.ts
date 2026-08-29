/**
 * transitionJob is a guarded UPDATE: an illegal move must leave the row
 * untouched and be reported, and racing writers must not both win.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { jobs, type JobStatus } from '@/lib/db/schema';
import { IllegalJobTransition, JobNotFound, transitionJob } from '@/lib/jobs/transitions';

async function makeJob(status: JobStatus = 'pending'): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({ id, kind: 'kie_image_generate', status, creditsCost: 21 });
  return id;
}
async function row(id: string) {
  const [r] = await db.select().from(jobs).where(eq(jobs.id, id));
  return r;
}

beforeEach(async () => {
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  await db.execute(sql`TRUNCATE TABLE jobs`);
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
});
afterAll(async () => {
  await db.$client.end();
});

describe('transitionJob', () => {
  it('walks pending → running → completed and stamps the timestamps', async () => {
    const id = await makeJob();
    expect(await transitionJob(db, id, 'running', { kieTaskId: 'task-1' })).toBe('applied');
    const running = await row(id);
    expect(running.status).toBe('running');
    expect(running.startedAt).toBeInstanceOf(Date);
    expect(running.finishedAt).toBeNull();
    expect(running.kieTaskId).toBe('task-1');

    await transitionJob(db, id, 'completed', { result: { ok: true } });
    const done = await row(id);
    expect(done.status).toBe('completed');
    expect(done.finishedAt).toBeInstanceOf(Date);
    expect(done.startedAt?.getTime()).toBe(running.startedAt?.getTime());
  });

  it('refuses to fail a completed job and leaves the row untouched', async () => {
    const id = await makeJob('completed');
    await expect(
      transitionJob(db, id, 'failed', { error: 'late watchdog' })
    ).rejects.toBeInstanceOf(IllegalJobTransition);
    const r = await row(id);
    expect(r.status).toBe('completed');
    expect(r.error).toBeNull();
  });

  it('tolerate: reports "refused" instead of throwing', async () => {
    const id = await makeJob('completed');
    expect(await transitionJob(db, id, 'timed_out', {}, { tolerate: true })).toBe('refused');
    expect(await transitionJob(db, randomUUID(), 'failed', {}, { tolerate: true })).toBe('refused');
  });

  it('throws JobNotFound for an unknown id', async () => {
    await expect(transitionJob(db, randomUUID(), 'running')).rejects.toBeInstanceOf(JobNotFound);
  });

  it('retry re-opens failed/timed_out jobs and clears finishedAt; completed needs force', async () => {
    const failed = await makeJob('failed');
    await transitionJob(db, failed, 'running');
    expect((await row(failed)).finishedAt).toBeNull();

    const timedOut = await makeJob('timed_out');
    expect(await transitionJob(db, timedOut, 'pending')).toBe('applied');

    const completed = await makeJob('completed');
    await expect(transitionJob(db, completed, 'running')).rejects.toBeInstanceOf(
      IllegalJobTransition
    );
    expect(await transitionJob(db, completed, 'running', {}, { force: true })).toBe('applied');
  });

  it('only one of two racing terminal writers wins', async () => {
    const id = await makeJob('running');
    const results = await Promise.all([
      transitionJob(db, id, 'completed', {}, { tolerate: true }),
      transitionJob(db, id, 'failed', { error: 'timeout' }, { tolerate: true })
    ]);
    expect(results.filter((r) => r === 'applied')).toHaveLength(1);
    const r = await row(id);
    expect(['completed', 'failed']).toContain(r.status);
  });
});
