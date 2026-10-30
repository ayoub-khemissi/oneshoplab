/**
 * The bulk worker's summary cache on real MySQL: the stamp query picks the
 * latest audit, and a re-score rewriting that same row is picked up.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findLatestAuditStampForProject } from '@/entities/audit';
import { forgetSummaryIndex, getSummaryIndex } from '@/features/bulk-generate/api/summary-cache';
import type { SummaryProduct } from '@/features/bulk-generate/lib/context';
import { matchSummaryProduct } from '@/features/bulk-generate/lib/summary-index';
import { db } from '@/shared/db';
import { audits } from '@/shared/db/schema';
import { resetTables } from './helpers';

const DOMAIN = 'atelier.example.com';
// Matched through the legacy leg (projectId IS NULL AND domain = …): no project row needed.
const PROJECT = randomUUID();
const MUG = { sourceId: null, handle: 'mug' };

const summary = (title: string) => ({
  allProducts: [
    { sourceId: null, handle: 'mug', title, descriptionHtml: '', images: [], signals: {} }
  ] satisfies SummaryProduct[]
});

async function audit(ageMin: number, title: string) {
  const id = randomUUID();
  const at = new Date(Date.now() - ageMin * 60_000);
  await db.insert(audits).values({
    id,
    url: `https://${DOMAIN}`,
    domain: DOMAIN,
    status: 'completed',
    createdAt: at,
    startedAt: at,
    completedAt: at,
    summary: summary(title)
  });
  return id;
}

const titleNow = async () =>
  matchSummaryProduct(await getSummaryIndex(PROJECT, DOMAIN), MUG)?.title ?? null;

beforeEach(async () => {
  await resetTables();
  forgetSummaryIndex();
});
afterAll(async () => {
  await db.$client.end();
});

describe('bulk summary cache', () => {
  it('stamps the latest audit', async () => {
    expect(await findLatestAuditStampForProject(PROJECT, DOMAIN)).toBeNull();
    await audit(60, 'old');
    const latest = await audit(5, 'new');
    expect(await findLatestAuditStampForProject(PROJECT, DOMAIN)).toMatchObject({
      id: latest,
      status: 'completed'
    });
    expect(await titleNow()).toBe('new');
  });

  it('reloads when a re-score rewrites the same audit in place', async () => {
    const id = await audit(5, 'first score');
    expect(await titleNow()).toBe('first score');
    // run-audit/api/refresh.ts: same row, new summary, completedAt bumped (whole seconds)
    await db
      .update(audits)
      .set({ summary: summary('rescored'), completedAt: new Date(Date.now() + 2_000) })
      .where(eq(audits.id, id));
    expect(await titleNow()).toBe('rescored');
  });
});
