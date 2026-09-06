'use client';

import { useEffect, useRef } from 'react';

/** Marks the entry we pushed, so we only ever pop our own. */
const MARKER = 'oslModal';

/**
 * Make a modal part of the navigation.
 *
 * On a phone, the system Back gesture is how people leave things. With a
 * modal that owns no history entry, Back leaves the PAGE instead — the
 * merchant loses the product they were working on to close a dialog. So an
 * open modal pushes an entry of its own: Back pops that entry and closes the
 * modal, exactly like the cross.
 *
 * Closing by the cross removes the entry again, or the next Back press would
 * be spent undoing a modal that is no longer on screen.
 *
 * The URL never changes — `pushState` is called with the current href — so
 * the router has nothing to re-render and a refresh still lands on the page,
 * not on a dialog.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void): void {
  // The caller passes a fresh arrow every render; re-subscribing on each one
  // would push a new entry per render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    window.history.pushState({ [MARKER]: true }, '', window.location.href);
    const onPop = () => close.current();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Still ours on top = we were closed by something other than Back.
      if ((window.history.state as Record<string, unknown> | null)?.[MARKER]) {
        window.history.back();
      }
    };
  }, [isOpen]);
}
