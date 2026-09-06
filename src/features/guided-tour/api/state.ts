import { eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { projects, users } from '@/shared/db/schema';
import { FIRST_STEP, stepById, type TourStepId } from '../model/steps';

export interface TourState {
  /** The step to open on. */
  step: TourStepId;
  /** The merchant's store, so "Next" can walk to it from the dashboard. */
  siteId: string | null;
}

/**
 * Should the walkthrough open by itself, and where?
 *
 * Only on a first store: someone who already runs three shops has answered
 * every question this tour asks, and an overlay over their catalogue is an
 * interruption, not help. Finishing or dismissing it closes the door for good
 * — reopening is a deliberate click in the preferences.
 */
export async function loadTourState(userId: string): Promise<TourState | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { tourStep: true, tourEndedAt: true }
  });
  if (!user || user.tourEndedAt) return null;

  const owned = await db
    .select({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(projects.createdAt)
    .limit(2);
  // The store count only gates the tour OPENING BY ITSELF. Someone who asked
  // for it — from the preferences, or by leaving it half-finished — gets it
  // back whatever their catalogue looks like; refusing then would be us
  // arguing with a deliberate click.
  if (owned.length > 1 && !user.tourStep) return null;

  return {
    step: stepById(user.tourStep)?.id ?? FIRST_STEP,
    siteId: owned[0]?.id ?? null
  };
}
