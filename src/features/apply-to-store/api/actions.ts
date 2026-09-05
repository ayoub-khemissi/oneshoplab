'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { imageRetentionDaysForPlan } from '@/entities/ai-model';
import {
  cancelChange,
  createChange,
  createReverseChange,
  dismissChange
} from '@/entities/product-change';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import {
  jobs,
  productChanges,
  products,
  projects,
  type Plan,
  type ProductChangeField
} from '@/shared/db/schema';
import { toChangeSummary } from '../lib/summary';
import type {
  ApplySelectionResult,
  ApproveResult,
  PendingChangeStatus,
  UndoResult
} from '../model/types';

const uuid = z.string().uuid();
const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const DAY_MS = 24 * 60 * 60 * 1000;

const FIELD_BY_KIND: Partial<Record<(typeof jobs.$inferSelect)['kind'], ProductChangeField>> = {
  kie_title: 'title',
  kie_description: 'description',
  kie_tags: 'tags',
  kie_image_edit: 'images'
};

/** Value in the shape the plugin receives (spec §3 `GET /changes`). */
function changeValue(field: ProductChangeField, result: unknown): unknown {
  const r = (result ?? {}) as {
    output?: string | string[];
    persistedUrls?: string[];
  };
  if (field === 'images') {
    return (r.persistedUrls ?? []).map((src) => ({ src, alt: null }));
  }
  return r.output ?? '';
}

function isEmpty(field: ProductChangeField, value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== 'string' || value.trim().length === 0;
}

/** "Apply to store" on a completed generation → one pending change (idempotent per job). */
export async function approveGenerationAction(formData: FormData): Promise<ApproveResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const jobId = uuid.safeParse(formData.get('jobId'));
  if (!jobId.success) return { ok: false, error: 'bad_request' };
  const res = await approveOneGeneration(session.user.id, session.user.plan ?? 'free', jobId.data);
  if (res.ok && res.projectId) revalidatePath(`/dashboard/sites/${res.projectId}`);
  return res;
}

/**
 * The body of "apply this generation", callable one job at a time.
 *
 * Split out so a merchant can send everything a product — or a whole store —
 * has waiting in one click, instead of clicking Apply once per generated
 * field. Ownership is re-checked per job: the caller passes a user id, never a
 * pre-authorised list.
 */
export async function approveOneGeneration(
  userId: string,
  plan: Plan,
  jobId: string
): Promise<ApproveResult> {
  const [row] = await db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(and(eq(jobs.id, jobId), eq(projects.userId, userId)));
  const job = row?.job;
  if (!job || !job.projectId || job.status !== 'completed') {
    return { ok: false, error: 'not_found' };
  }
  const field = FIELD_BY_KIND[job.kind];
  if (!field) return { ok: false, error: 'unsupported' };
  const value = changeValue(field, job.result);
  if (isEmpty(field, value)) return { ok: false, error: 'unsupported' };

  const [existing] = await db
    .select()
    .from(productChanges)
    .where(
      and(
        eq(productChanges.sourceJobId, job.id),
        inArray(productChanges.status, ['pending', 'applied'])
      )
    )
    .limit(1);
  if (existing) return { ok: true, change: toChangeSummary(existing) };

  const sourceId = (job.inputPayload as { productSourceId?: string } | null)?.productSourceId;
  const product = await db.query.products.findFirst({
    where: job.productId
      ? and(eq(products.id, job.productId), eq(products.projectId, job.projectId))
      : sourceId
        ? and(eq(products.projectId, job.projectId), eq(products.sourceId, sourceId))
        : undefined,
    columns: { id: true, sourceId: true, handle: true }
  });
  if (!product || (!job.productId && !sourceId)) return { ok: false, error: 'not_found' };

  // Image URLs die with the plan's retention window — the plugin must copy
  // them before that, so the change carries the same deadline.
  const expiresAt =
    field === 'images'
      ? new Date(job.createdAt.getTime() + imageRetentionDaysForPlan(plan) * DAY_MS)
      : null;

  const created = await createChange({
    projectId: job.projectId,
    productId: product.id,
    productSourceId: product.sourceId ?? product.handle ?? product.id,
    field,
    value,
    sourceJobId: job.id,
    approvedBy: userId,
    expiresAt
  });
  if (!created.ok) {
    return { ok: false, error: created.reason === 'not_found' ? 'not_found' : 'invalid_value' };
  }
  // The caller revalidates: sending a whole store calls this hundreds of times
  // and one revalidation at the end is the same result for a fraction of the
  // work — and this helper then stays callable outside a request.
  return { ok: true, change: toChangeSummary(created.change), projectId: job.projectId };
}

/**
 * "Annuler" on an applied change: queues the reverse change (IMAGE-OPS.md §3).
 * Refused with `conflict` when the product moved in the store since — the UI
 * says so instead of silently overwriting the merchant's own edit.
 */
export async function undoChangeAction(formData: FormData): Promise<UndoResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = uuid.safeParse(formData.get('projectId'));
  const changeId = ulidSchema.safeParse(formData.get('changeId'));
  if (!projectId.success || !changeId.success) return { ok: false, error: 'bad_request' };

  const res = await createReverseChange(projectId.data, changeId.data, session.user.id);
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath(`/dashboard/sites/${projectId.data}`);
  return { ok: true, change: toChangeSummary(res.change) };
}

const MAX_APPLY_SELECTION = 100;
const OPEN_STATUSES: readonly PendingChangeStatus[] = ['pending', 'conflict', 'failed'];

/**
 * "Apply the selection" in the pending-changes modal. Nothing new is decided
 * here: a change already `pending` is on its way (the plugin polls, the
 * connectors push on their tick), and a `conflict` / `failed` one is sent
 * again through `approveGenerationAction` — the very path the per-generation
 * button uses, idempotent per source job. A change with no source job (an
 * image-editor queue, a reverse change) has nothing to replay, so it is
 * reported back rather than silently counted as sent.
 */
export async function applyPendingChangesAction(
  projectId: string,
  changeIds: string[]
): Promise<ApplySelectionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const project = uuid.safeParse(projectId);
  const ids = z.array(ulidSchema).min(1).max(MAX_APPLY_SELECTION).safeParse(changeIds);
  if (!project.success || !ids.success) return { ok: false, error: 'bad_request' };

  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, project.data), eq(projects.userId, session.user.id)));
  if (!owned) return { ok: false, error: 'not_found' };

  const rows = await db
    .select()
    .from(productChanges)
    .where(
      and(
        eq(productChanges.projectId, project.data),
        inArray(productChanges.id, ids.data),
        inArray(productChanges.status, [...OPEN_STATUSES])
      )
    );

  let queued = 0;
  let conflict = 0;
  let failed = 0;
  for (const change of rows) {
    if (change.status === 'pending') {
      queued += 1;
      continue;
    }
    if (change.sourceJobId) {
      const fd = new FormData();
      fd.set('jobId', change.sourceJobId);
      if ((await approveGenerationAction(fd)).ok) {
        queued += 1;
        continue;
      }
    }
    if (change.status === 'conflict') conflict += 1;
    else failed += 1;
  }
  revalidatePath(`/dashboard/sites/${project.data}`);
  return { ok: true, queued, conflict, failed };
}

/**
 * "Ignorer" on a failure or a conflict the merchant doesn't want to see any
 * more. Nothing is replayed and nothing is deleted — the row keeps the reason
 * the store gave, only the banners stop counting it.
 */
export async function dismissChangeAction(
  formData: FormData
): Promise<{ ok: boolean; error?: 'unauthorized' | 'bad_request' | 'not_found' | 'refused' }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = uuid.safeParse(formData.get('projectId'));
  const changeId = ulidSchema.safeParse(formData.get('changeId'));
  if (!projectId.success || !changeId.success) return { ok: false, error: 'bad_request' };
  const res = await dismissChange(projectId.data, changeId.data, session.user.id);
  if (res === 'dismissed') {
    revalidatePath(`/dashboard/sites/${projectId.data}`);
    return { ok: true };
  }
  return { ok: false, error: res };
}

export async function cancelChangeAction(
  formData: FormData
): Promise<{ ok: boolean; error?: 'unauthorized' | 'bad_request' | 'not_found' | 'refused' }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const projectId = uuid.safeParse(formData.get('projectId'));
  const changeId = ulidSchema.safeParse(formData.get('changeId'));
  if (!projectId.success || !changeId.success) return { ok: false, error: 'bad_request' };
  const res = await cancelChange(projectId.data, changeId.data, session.user.id);
  if (res === 'cancelled') {
    revalidatePath(`/dashboard/sites/${projectId.data}`);
    return { ok: true };
  }
  return { ok: false, error: res };
}
