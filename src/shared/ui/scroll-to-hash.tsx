'use client';

import { useEffect } from 'react';

/** How long to keep looking for an anchor the page may still be streaming. */
const POLL_MS = 120;
const ATTEMPTS = 25;
/** Long enough to notice, short enough not to become decoration. */
const FLASH_MS = 1600;

/**
 * Take a `#fragment` to the thing it names, and say which thing it was.
 *
 * The browser's own fragment scrolling happens once, at load, against whatever
 * markup exists at that instant — which on a streamed server-rendered page is
 * routinely not the row the notification was about. So the anchor is looked
 * for over a couple of seconds instead of once, and then briefly outlined:
 * landing at the right scroll position is useless if the merchant cannot tell
 * which of six similar rows the notice meant.
 *
 * Mounted on the pages notifications lead to. It does nothing at all when
 * there is no fragment, which is almost every visit.
 */
export function ScrollToHash() {
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let flash: number | undefined;

    const find = () => {
      if (!alive) return;
      attempts += 1;
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) {
        if (attempts < ATTEMPTS) window.setTimeout(find, POLL_MS);
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('anchor-flash');
      flash = window.setTimeout(() => el.classList.remove('anchor-flash'), FLASH_MS);
    };

    // A tap on a notification while the app is already open changes only the
    // fragment, which is not a navigation and re-runs no effect of its own.
    const onHashChange = () => {
      attempts = 0;
      find();
    };
    const first = window.setTimeout(find, 0);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearTimeout(flash);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  return null;
}
