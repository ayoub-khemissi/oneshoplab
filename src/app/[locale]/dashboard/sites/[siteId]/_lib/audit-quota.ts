import { and, desc, gte, inArray } from 'drizzle-orm';
import { AUDIT_RATE_LIMIT_WINDOW_MS, auditRateLimitForPlan } from '@/lib/ai/models';
import { db } from '@/lib/db';
import { audits } from '@/lib/db/schema';

export type UserPlan = 'free' | 'starter' | 'pro' | 'scale';

export interface AuditQuota {
  auditsLimit: number;
  auditsUsed: number;
  nextSlotAtIso: string | null;
}

// Audit rate-limit window: count user-wide pending/running/completed
// audits in the last 24h. Failed/timed_out ones don't count so a bad
// first run doesn't lock the merchant out. The Relaunch button uses
// this to display "X / Y today" or a countdown to the next slot.
export async function loadAuditQuota(
  userPlan: UserPlan,
  userProjectIdsList: string[]
): Promise<AuditQuota> {
  const auditsLimit = auditRateLimitForPlan(userPlan);
  let auditsUsed = 0;
  let nextSlotAtIso: string | null = null;
  if (userProjectIdsList.length > 0) {
    const since = new Date(Date.now() - AUDIT_RATE_LIMIT_WINDOW_MS);
    const inWindow = await db.query.audits.findMany({
      where: and(
        inArray(audits.projectId, userProjectIdsList),
        gte(audits.createdAt, since),
        inArray(audits.status, ['pending', 'running', 'completed'])
      ),
      columns: { id: true, createdAt: true },
      orderBy: [desc(audits.createdAt)]
    });
    auditsUsed = inWindow.length;
    if (auditsUsed >= auditsLimit && inWindow.length > 0) {
      // Oldest in the window is the last item (orderBy desc).
      const oldest = inWindow[inWindow.length - 1];
      nextSlotAtIso = new Date(
        oldest.createdAt.getTime() + AUDIT_RATE_LIMIT_WINDOW_MS
      ).toISOString();
    }
  }
  return { auditsLimit, auditsUsed, nextSlotAtIso };
}
