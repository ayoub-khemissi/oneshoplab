'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { embeddedLinkAction, filenameFromDisposition } from './lib';

async function download(href: string): Promise<void> {
  const res = await fetch(href);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromDisposition(
    res.headers.get('content-disposition'),
    href.split('?')[0].split('/').pop() || 'download'
  );
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Mounted only inside the Shopify admin: turns the plain links that would
 * reload the frame without a session into router navigations and fetched
 * downloads (see `embeddedLinkAction`).
 */
export function EmbeddedLinkGuard() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const action = embeddedLinkAction(
        {
          href: anchor.getAttribute('href') ?? '',
          target: anchor.getAttribute('target'),
          download: anchor.hasAttribute('download')
        },
        window.location.origin
      );
      if (action === 'ignore') return;
      event.preventDefault();
      if (action === 'download') void download(anchor.href);
      else router.push(anchor.href.slice(window.location.origin.length));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
  return null;
}
