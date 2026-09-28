/** The per-tick audit watchdog: only stale pending/running audits are failed. */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';
import { runAuditWatchdog } from '../../src/worker/audit-watchdog';
import { resetTables } from './helpers';

async function audit(status: 'pending' | 'running' | 'completed' | 'failed', ageMin: number) {
  const id = randomUUID();
  await db.insert(audits).values({
    id,
    url: 'https://atelier.example.com',
    domain: 'atelier.example.com',
    status,
    createdAt: new Date(Date.now() - ageMin * 60_000)
  });
  return id;
}

const statusOf = async (id: string) =>
  await db.query.audits.findFirst({
    where: eq(audits.id, id),
    columns: { status: true, error: true }
  });

beforeEach(resetTables);
afterAll(async () => {
  await db.$client.end();
});

describe('runAuditWatchdog', () => {
  it('fails stale pending/running audits and leaves fresh or finished ones alone', async () => {
    const stalePending = await audit('pending', 20);
    const staleRunning = await audit('running', 9);
    const freshRunning = await audit('running', 2);
    const oldCompleted = await audit('completed', 600);
    expect(await runAuditWatchdog()).toEqual({ recovered: 2 });
    expect(await statusOf(stalePending)).toEqual({
      status: 'failed',
      error: 'process_interrupted'
    });
    expect(await statusOf(staleRunning)).toMatchObject({ status: 'failed' });
    expect(await statusOf(freshRunning)).toMatchObject({ status: 'running' });
    expect(await statusOf(oldCompleted)).toMatchObject({ status: 'completed' });
    expect(await runAuditWatchdog()).toEqual({ recovered: 0 });
  });
});
