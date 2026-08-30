/**
 * `POST /api/v1/products/sync` business logic (spec §3). Throws `ApiError`
 * for every refusal so the route stays a parse → call → respond shim.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import type { ProjectRow } from '@/entities/api-key';
import {
  archiveProductsNotSeen,
  countActiveProducts,
  existingSourceIds,
  syncProjectProducts
} from '@/entities/product';
import { ApiError } from '@/shared/api';
import { db } from '@/shared/db';
import { projects, users, type Platform } from '@/shared/db/schema';
import { toNormalizedProduct } from '../lib/normalize';
import type { SyncBody } from '../lib/schema';
import { addSeenSourceIds, closeSession, resumeSession, startSession } from './sessions';

export const SYNC_LOCK_TIMEOUT_SEC = 5;
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

/**
 * Advisory lock around `fn`. GET_LOCK is per connection, so both calls run
 * inside one transaction (one pinned connection) while `fn` itself uses
 * the pool: the lock only serialises batches, it is not the write txn.
 */
async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const name = `osl:sync:${projectId}`;
  return db.transaction(async (tx) => {
    const [rows] = await tx.execute(sql`SELECT GET_LOCK(${name}, ${SYNC_LOCK_TIMEOUT_SEC}) AS ok`);
    const ok = Array.isArray(rows) ? (rows[0] as { ok: number | null } | undefined)?.ok : null;
    if (ok !== 1) {
      throw new ApiError('locked', 'Another sync batch holds the project lock', 423, {
        retryAfterSec: SYNC_LOCK_TIMEOUT_SEC
      });
    }
    try {
      return await fn();
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${name})`);
    }
  });
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
