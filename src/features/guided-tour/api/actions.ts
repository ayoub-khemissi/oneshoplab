'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';
import { FIRST_STEP, TOUR_STEP_IDS, type TourStepId } from '../model/steps';

function isStepId(value: unknown): value is TourStepId {
  return typeof value === 'string' && (TOUR_STEP_IDS as readonly string[]).includes(value);
}

/**
 * Remember where the walkthrough got to.
 *
 * Written on every step rather than at the end: a merchant who closes the tab
 * mid-tour comes back to the step they were on, not to the beginning. It is a
 * hint, never a gate — a failed write costs a repeated step and nothing else,
 * so the caller does not wait on it.
 */
export async function setTourStepAction(step: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !isStepId(step)) return { ok: false };
  await db.update(users).set({ tourStep: step }).where(eq(users.id, session.user.id));
  return { ok: true };
}

/** Finished, or "not now" — both mean it never opens by itself again. */
export async function endTourAction(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  await db.update(users).set({ tourEndedAt: new Date() }).where(eq(users.id, session.user.id));
  return { ok: true };
}

/** "Replay the tutorial", from the account preferences. */
export async function restartTourAction(): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  await db
    .update(users)
    // Back to the first step, and marked as started: an explicit replay is
    // not subject to the "first store only" rule that gates the auto-open.
    .set({ tourEndedAt: null, tourStep: FIRST_STEP })
    .where(eq(users.id, session.user.id));
  return { ok: true };
}
