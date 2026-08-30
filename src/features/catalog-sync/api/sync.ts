/**
 * `POST /api/v1/products/sync` business logic (spec §3). Throws `ApiError`
 * for every refusal so the route stays a parse → call → respond shim.
 */
import { eq } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import type { ProjectRow } from '@/entities/api-key';
import {
  ProjectSyncLocked,
  SYNC_LOCK_TIMEOUT_SEC,
  archiveProductsNotSeen,
  countActiveProducts,
  existingSourceIds,
  syncProjectProducts,
  withProjectSyncLock
} from '@/entities/product';
import { emitProjectEvent } from '@/entities/outbound-webhook';
import { ApiError } from '@/shared/api';
import { db } from '@/shared/db';
import { projects, users, type Platform } from '@/shared/db/schema';
import { toNormalizedProduct } from '../lib/normalize';
import type { SyncBody } from '../lib/schema';
import { addSeenSourceIds, closeSession, resumeSession, startSession } from './sessions';

export { SYNC_LOCK_TIMEOUT_SEC };
/** Platforms a plugin may declare through `X-OSL-Platform`. */
export const PLUGIN_PLATFORMS = ['shopify', 'woocommerce', 'wix'] as const;
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number];

export interface SyncResponse {
  inserted: number;
  updated: number;
  archived: number;
  unchanged: number;
  session?: string;
  errors: { index: number; sourceId: string; code: string }[];
}

export interface SyncInput {
  project: ProjectRow;
  body: SyncBody;
  /** Raw `X-OSL-Platform` header, validated here. */
  platformHeader: string | null;
}

export function parsePluginPlatform(header: string | null): PluginPlatform | null {
  const v = header?.trim().toLowerCase();
  return (PLUGIN_PLATFORMS as readonly string[]).includes(v ?? '') ? (v as PluginPlatform) : null;
}

/** `projects.source` is set from the header the first time it is still `unknown`. */
async function resolvePlatform(project: ProjectRow, header: string | null): Promise<Platform> {
  const declared = parsePluginPlatform(header);
  if (project.source !== 'unknown' || !declared) return project.source;
  await db.update(projects).set({ source: declared }).where(eq(projects.id, project.id));
  return declared;
}

async function planLimitFor(project: ProjectRow): Promise<number> {
  const [owner] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, project.userId));
  return maxProductsForPlan(owner?.plan);
}

async function assertPlanLimit(project: ProjectRow, sourceIds: string[]): Promise<void> {
  const [maxProducts, current, known] = await Promise.all([
    planLimitFor(project),
    countActiveProducts(project.id),
    existingSourceIds(project.id, sourceIds)
  ]);
  const incoming = sourceIds.filter((id) => !known.has(id)).length;
  if (current + incoming > maxProducts) {
    throw new ApiError('plan_limit', 'Plan product limit exceeded', 422, {
      maxProducts,
      current,
      incoming
    });
  }
}

/** `423 locked` when another writer (plugin batch or Shopify pull) holds the project. */
async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withProjectSyncLock(projectId, fn);
  } catch (e) {
    if (e instanceof ProjectSyncLocked) {
      throw new ApiError('locked', 'Another sync batch holds the project lock', 423, {
        retryAfterSec: SYNC_LOCK_TIMEOUT_SEC
      });
    }
    throw e;
  }
}

export async function syncCatalog(input: SyncInput): Promise<SyncResponse> {
  const { project, body } = input;
  const sourceIds = body.products.map((p) => p.sourceId);

  const session =
    body.mode === 'full'
      ? body.session
        ? await resumeSession(project.id, body.session)
        : await startSession(project.id)
      : null;

  let response: SyncResponse;
  try {
    response = await runSync(input, session, sourceIds);
  } catch (e) {
    await emitProjectEvent(project.id, 'sync.failed', {
      source: 'plugin',
      mode: body.mode,
      reason: e instanceof ApiError ? e.code : 'error',
      error: e instanceof Error ? e.message.slice(0, 500) : String(e)
    });
    throw e;
  }
  // Full mode: one event per completed sync, not per page.
  if (body.mode === 'partial' || body.final) {
    const { session: _s, errors: _e, ...counts } = response;
    await emitProjectEvent(project.id, 'sync.completed', {
      source: 'plugin',
      mode: body.mode,
      ...counts
    });
  }
  return response;
}

async function runSync(
  input: SyncInput,
  session: Awaited<ReturnType<typeof startSession>> | null,
  sourceIds: string[]
): Promise<SyncResponse> {
  const { project, body } = input;
  return withProjectLock(project.id, async () => {
    await assertPlanLimit(project, sourceIds);
    const platform = await resolvePlatform(project, input.platformHeader);
    const normalized = body.products.map((p) => toNormalizedProduct(p, platform));
    const counts = await syncProjectProducts(project.id, platform, normalized, {
      archiveMissing: false
    });

    let archived = 0;
    if (session) {
      const seen = await addSeenSourceIds(session, sourceIds);
      if (body.final) {
        archived = await archiveProductsNotSeen(project.id, seen);
        await closeSession(session.id);
      }
    }
    return {
      inserted: counts.inserted,
      updated: counts.updated,
      archived,
      unchanged: counts.unchanged,
      ...(session ? { session: session.id } : {}),
      errors: []
    };
  });
}
