'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { refreshKeepingScroll } from '@/lib/preserve-scroll';

/**
 * Triggers a server-side route refresh on a fixed interval as long as this
 * component is mounted. Used to update pages waiting on a background job
 * (e.g. audit pending → completed) without writing a polling endpoint:
 * the page itself is the "endpoint" that re-renders with fresh DB state.
 *
 * Mount this only when the watched job is in a non-terminal state so it
 * unmounts (and stops refreshing) as soon as the result is in.
 */
export function AutoRefresh({ intervalMs = 2500 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      refreshKeepingScroll(() => router.refresh());
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
