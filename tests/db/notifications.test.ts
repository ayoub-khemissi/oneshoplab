/**
 * Bell notifications: per-user, capped at KEEP_PER_USER (oldest trimmed),
 * read-marking by job / audit / all, strict cross-user isolation.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { jobs, notifications } from '@/shared/db/schema';
import { listForBell, markAllRead, markReadByJob, notify } from '@/entities/notification';
import { createUser, resetTables } from './helpers';

async function makeJob(): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({ id, kind: 'kie_image_generate', status: 'completed' });
  return id;
}

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('notify / listForBell', () => {
  it('stores a notification, lists newest first, isolated per user', async () => {
    const a = await createUser();
    const b = await createUser();
    await notify({ userId: a, kind: 'audit_completed', payload: { domain: 'a.com' } });
    await notify({ userId: b, kind: 'image_failed' });
    const forA = await listForBell(a);
    expect(forA.unreadCount).toBe(1);
    expect(forA.rows.map((r) => r.kind)).toEqual(['audit_completed']);
    const rowsA = await db.query.notifications.findMany({ where: eq(notifications.userId, a) });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({ kind: 'audit_completed', isRead: false });
  });

  it('keeps only the 20 newest per user', async () => {
    const a = await createUser();
    for (let i = 0; i < 23; i++) {
      await db.insert(notifications).values({
        id: randomUUID(),
        userId: a,
        kind: 'chat_completed',
        createdAt: new Date(Date.now() - (30 - i) * 60_000)
      });
    }
    await notify({ userId: a, kind: 'chat_completed', payload: { last: true } });
    const rows = await db.query.notifications.findMany({ where: eq(notifications.userId, a) });
    expect(rows).toHaveLength(20);
    expect(rows.some((r) => (r.payload as { last?: boolean } | null)?.last)).toBe(true);
  });
});

describe('mark as read', () => {
  it('markReadByJob only touches that job; markAllRead clears the rest — for that user only', async () => {
    const a = await createUser();
    const b = await createUser();
    const job1 = await makeJob();
    const job2 = await makeJob();
    await notify({ userId: a, kind: 'image_completed', jobId: job1 });
    await notify({ userId: a, kind: 'chat_completed', jobId: job2 });
    await notify({ userId: b, kind: 'image_completed', jobId: job1 });

    const byJob = await markReadByJob(a, job1);
    expect(byJob.updated).toBe(1);
    const unreadA = (
      await db.query.notifications.findMany({ where: eq(notifications.userId, a) })
    ).filter((n) => !n.isRead);
    expect(unreadA).toHaveLength(1);

    const all = await markAllRead(a);
    expect(all.updated).toBe(1);
    expect(
      (await db.query.notifications.findMany({ where: eq(notifications.userId, a) })).every(
        (n) => n.isRead
      )
    ).toBe(true);
    expect(
      (await db.query.notifications.findMany({ where: eq(notifications.userId, b) })).every(
        (n) => !n.isRead
      )
    ).toBe(true);
  });
});
