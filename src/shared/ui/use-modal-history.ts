'use client';

import { useEffect, useRef } from 'react';

/** Marks the entry we pushed, so we only ever answer for our own. */
const MARKER = 'oslModal';

/**
 * Make a modal part of the navigation: the system Back gesture closes it
 * instead of leaving the page.
 *
 * On a phone, Back is how people leave things, and a modal that owns no
 * history entry costs the merchant the product they were working on just to
 * dismiss a dialog. So an open modal pushes an entry of its own and closes
 * when it is popped.
 *
 * **It never calls `history.back()` itself.** A first version did, to tidy up
 * the entry when the modal was closed by the cross — and that broke every
 * link in the app: the URL stayed put while Next's router walked its own tree
 * back one step, so it was left pointing at a route that no longer matched
 * the address, and `<Link>` clicks computed a transition from a stale tree and
 * did nothing at all. Shipped 2026-09-06, reported by a merchant within the
 * hour. Whatever this hook wants, it is not worth writing into history behind
 * the router's back.
 *
 * The price of that restraint is one dead Back press: closing with the cross
 * leaves the entry behind, so the next Back lands on the same page before the
 * one after it leaves. A press that does nothing is a far better failure than
 * a link that does nothing.
 *
 * The entry is pushed once per page visit, not once per opening — reopening a
 * dialog five times must not cost five presses to leave.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void): void {
  // The caller passes a fresh arrow every render; depending on it directly
  // would re-run this on each one.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const state = window.history.state as Record<string, unknown> | null;
    if (!state?.[MARKER]) {
      // Same URL, and Next's own keys carried over: this must read as the page
      // it already is, to the router as much as to the merchant.
      window.history.pushState({ ...state, [MARKER]: true }, '', window.location.href);
    }
    const onPop = () => close.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isOpen]);
}
