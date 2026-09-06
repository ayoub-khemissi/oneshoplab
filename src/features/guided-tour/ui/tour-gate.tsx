import { Suspense } from 'react';
import { auth } from '@/entities/user';
import { loadTourState } from '../api/state';
import { TourMount } from './tour-mount';

/**
 * Opens the walkthrough for a merchant on their first store, and for nobody
 * else. Renders nothing at all in every other case, so the dashboard of an
 * account with three shops pays one indexed read and no markup.
 *
 * `useSearchParams` inside the overlay needs a Suspense boundary of its own;
 * the fallback is nothing, because a tutorial that flashes a skeleton over
 * the page it is explaining is worse than one that arrives a beat later.
 */
export async function TourGate() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const state = await loadTourState(session.user.id);
  if (!state) return null;
  return (
    <Suspense fallback={null}>
      <TourMount initialStep={state.step} siteId={state.siteId} />
    </Suspense>
  );
}
