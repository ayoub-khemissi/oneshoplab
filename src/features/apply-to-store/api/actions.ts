'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { imageRetentionDaysForPlan } from '@/entities/ai-model';
import { cancelChange, createChange, createReverseChange } from '@/entities/product-change';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import {
  jobs,
  productChanges,
  products,
  projects,
  type ProductChangeField
} from '@/shared/db/schema';
import { toChangeSummary } from '../lib/summary';
import type { ApproveResult, UndoResult } from '../model/types';

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

  const [row] = await db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(and(eq(jobs.id, jobId.data), eq(projects.userId, session.user.id)));
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
      ? new Date(
          job.createdAt.getTime() + imageRetentionDaysForPlan(session.user.plan ?? 'free') * DAY_MS
        )
      : null;

  const created = await createChange({
    projectId: job.projectId,
    productId: product.id,
    productSourceId: product.sourceId ?? product.handle ?? product.id,
    field,
    value,
    sourceJobId: job.id,
    approvedBy: session.user.id,
    expiresAt
  });
  if (!created.ok) {
    return { ok: false, error: created.reason === 'not_found' ? 'not_found' : 'invalid_value' };
  }
  revalidatePath(`/dashboard/sites/${job.projectId}`);
  return { ok: true, change: toChangeSummary(created.change) };
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
