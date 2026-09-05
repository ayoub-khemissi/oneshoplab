'use server';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { jobs, productChanges, projects } from '@/shared/db/schema';
import { approveOneGeneration } from './actions';

const uuid = z.string().uuid();

/** Generation kinds that produce something a store can take. */
const SENDABLE_KINDS = ['kie_title', 'kie_description', 'kie_tags', 'kie_image_edit'] as const;

/**
 * How far back a "send everything" looks. A store that has been generating for
 * months carries thousands of jobs, and only the newest per product and field
 * can still be sent — the older ones were superseded by the very generations
 * above them. Scanning the recent window keeps one indexed read bounded while
 * covering every case a merchant would recognise as "waiting".
 */
const SCAN_LIMIT = 2000;
/** Changes queued per click. The worker drains ~300/minute per store. */
const SEND_LIMIT = 500;

export type SendAllResult =
  | { ok: true; queued: number; skipped: number }
  | { ok: false; error: 'unauthorized' | 'bad_request' | 'not_found' };

/**
 * Generations this store (or this product) could still send: the newest one per
 * product and field, with no change already carrying it.
 *
 * Deduplicated here rather than in SQL — a correlated "latest per group"
 * subquery over the jobs table costs far more than walking a bounded, ordered
 * page of it.
 */
export async function listSendableJobIds(projectId: string, productId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: jobs.id, productId: jobs.productId, kind: jobs.kind })
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, projectId),
        eq(jobs.status, 'completed'),
        inArray(jobs.kind, [...SENDABLE_KINDS]),
        productId ? eq(jobs.productId, productId) : undefined
      )
    )
    .orderBy(desc(jobs.createdAt))
    .limit(SCAN_LIMIT);

  const newest: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.productId ?? ''}:${row.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    newest.push(row.id);
  }
  if (newest.length === 0) return [];

  // Anything already queued or landed is not "waiting" — and re-approving is a
  // no-op anyway, so this only keeps the count honest.
  const taken = await db
    .select({ sourceJobId: productChanges.sourceJobId })
    .from(productChanges)
    .where(
      and(
        inArray(productChanges.sourceJobId, newest),
        inArray(productChanges.status, ['pending', 'applied'])
      )
    );
  const done = new Set(taken.map((t) => t.sourceJobId));
  return newest.filter((id) => !done.has(id));
}

/** How many generations are waiting — drives the button and its label. */
export async function countSendableGenerationsAction(
  projectId: string,
  productId?: string
): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) return 0;
  const id = uuid.safeParse(projectId);
  if (!id.success) return 0;
  const owned = await db.query.projects.findFirst({
    where: and(eq(projects.id, id.data), eq(projects.userId, session.user.id)),
    columns: { id: true }
  });
  if (!owned) return 0;
  return (await listSendableJobIds(id.data, productId)).length;
}

/**
 * "Send everything" — one click instead of one per generated field.
 *
 * Each job still goes through the same per-job approval, ownership check and
 * value validation as the single button: this queues work, it does not skip
 * any of the rules. Whatever the store cannot take is reported as skipped
 * rather than failing the whole batch.
 */
export async function sendAllGenerationsAction(
  projectId: string,
  productId?: string
): Promise<SendAllResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(projectId);
  if (!id.success) return { ok: false, error: 'bad_request' };
  const owned = await db.query.projects.findFirst({
    where: and(eq(projects.id, id.data), eq(projects.userId, session.user.id)),
    columns: { id: true }
  });
  if (!owned) return { ok: false, error: 'not_found' };

  const jobIds = (await listSendableJobIds(id.data, productId)).slice(0, SEND_LIMIT);
  let queued = 0;
  let skipped = 0;
  for (const jobId of jobIds) {
    const res = await approveOneGeneration(session.user.id, session.user.plan ?? 'free', jobId);
    if (res.ok) queued += 1;
    else skipped += 1;
  }
  // Once for the batch, not once per job.
  if (queued > 0) revalidatePath(`/dashboard/sites/${id.data}`);
  return { ok: true, queued, skipped };
}
