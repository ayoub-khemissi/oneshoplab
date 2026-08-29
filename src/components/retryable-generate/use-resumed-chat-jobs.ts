import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { GenField } from '@/components/generate-button';
import { refreshKeepingScroll } from '@/lib/preserve-scroll';

export function useResumedChatJobsPoll(
  productId: string,
  inFlightChatJobs: ReadonlyArray<{ field: GenField }>
): void {
  const router = useRouter();
  // Resume-from-F5 poll: when the page mounts with one or more chat
  // jobs still 'running' server-side, the original submit's fetch is
  // gone (the previous tab closed on reload), so the provider has no
  // way to know when the server finishes. Poll a lightweight endpoint
  // every 2.5s and router.refresh() once every resumed field has
  // flipped off — the refresh re-fetches inFlightChatJobs and
  // unsticks the spinner naturally. The poll only runs for fields
  // that came back pending from the server, never for ones the user
  // clicks in-tab.
  const resumedRef = useRef<Set<GenField>>(new Set(inFlightChatJobs.map((j) => j.field)));
  useEffect(() => {
    if (resumedRef.current.size === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/products/text-jobs?productId=${encodeURIComponent(productId)}`,
          {
            headers: { accept: 'application/json' }
          }
        );
        if (cancelled) return;
        if (!res.ok) return;
        const body = (await res.json()) as { running?: string[] };
        const stillRunning = new Set(body.running ?? []);
        // Drop the resumed marker on any field the server no longer
        // reports as running — that field's job has flipped to
        // completed or failed. We refresh once to pick up the new
        // product state (description text, etc.).
        let cleared = 0;
        for (const f of Array.from(resumedRef.current)) {
          if (!stillRunning.has(f)) {
            resumedRef.current.delete(f);
            cleared += 1;
          }
        }
        if (cleared > 0) refreshKeepingScroll(() => router.refresh());
      } catch {
        // Network hiccup — keep polling; the poll loop is best-effort.
      }
    };
    const id = window.setInterval(tick, 2500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // We intentionally do NOT depend on `states` here — the resumed
    // tracker is its own bag, fed only by the F5 seed.
  }, [productId, router]);
}
