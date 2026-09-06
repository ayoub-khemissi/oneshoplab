'use client';

import { endTourAction, setTourStepAction } from '../actions';
import { GuidedTour } from './guided-tour';
import type { TourChapterId, TourStepId } from '../model/steps';

/**
 * Wires the overlay to the account.
 *
 * The writes are deliberately not awaited: the walkthrough must never stutter
 * on a round-trip, and the worst a lost write can do is replay one step.
 */
export function TourMount({
  initialStep,
  siteId,
  chapter
}: {
  initialStep: TourStepId;
  siteId: string | null;
  chapter: TourChapterId | null;
}) {
  return (
    <GuidedTour
      initialStep={initialStep}
      siteId={siteId}
      chapter={chapter}
      onStep={(step) => void setTourStepAction(step)}
      onEnd={() => void endTourAction()}
    />
  );
}
