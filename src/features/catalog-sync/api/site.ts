import { eq } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import type { SiteKeyContext } from '@/entities/api-key';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';
import { SYNC_BATCH_SIZE } from '../lib/schema';

/** `GET /api/v1/site` payload — the plugin's "test connection" call. */
export async function describeSite(ctx: Pick<SiteKeyContext, 'key' | 'project'>) {
  const [owner] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, ctx.project.userId));
  const plan = owner?.plan ?? 'free';
  return {
    site: {
      id: ctx.project.id,
      name: ctx.project.name,
      domain: ctx.project.domain,
      platform: ctx.project.source,
      plan,
      limits: { maxProducts: maxProductsForPlan(plan), batchSize: SYNC_BATCH_SIZE }
    },
    key: {
      prefix: ctx.key.prefix,
      permissions: ctx.key.permissions,
      expiresAt: ctx.key.expiresAt?.toISOString() ?? null,
      graceUntil: ctx.key.graceUntil?.toISOString() ?? null
    },
    serverTime: new Date().toISOString()
  };
}
