'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { errorKeyFromCode, rehydrateDates } from './helpers';
import type { BusyKind, ImageAngle } from './types';
import type { ImageJobRow } from '@/entities/generation-job';
import { refreshKeepingScroll } from '@/lib/preserve-scroll';

interface UseImageJobsArgs {
  siteId: string;
  productId: string;
  initial: ImageJobRow[];
}

/**
 * State + mutations behind `AiImageGridLive`: hydrates from the server
 * snapshot, polls /api/products/image-jobs while any job is non-terminal,
 * listens for the `oneshoplab:kick-image-poll` event, and owns the
 * add/regenerate modal state so the submit path can close it.
 */
export function useImageJobs({ siteId, productId, initial }: UseImageJobsArgs) {
  const t = useTranslations('AiImageGrid');
  const router = useRouter();

  const [rawJobs, setJobs] = useState<ImageJobRow[]>(() => initial.map(rehydrateDates));
  // Starts at 0 (not Date.now()) so the SSR render and the client's
  // first render agree — Date.now() at render time differs between
  // the two and trips React #418. The effect below sets the real
  // clock on mount; until then elapsedSec computes to 0 everywhere.
  const [now, setNow] = useState<number>(0);
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  // When set, the modal submits as a "regenerate this slot" instead of
  // a brand-new addition. The old job is hidden server-side as part of
  // the same POST so the grid stays at its current size.
  const [modalReplaceId, setModalReplaceId] = useState<string | null>(null);

  // 1-Hz tick: drives the elapsed-time captions on skeletons.
  // setNow immediately on mount so the caption doesn't sit at 0 for
  // a full second after hydration.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync from the server-provided `initial` whenever the parent
  // re-renders with a new snapshot — typically after `router.refresh()`
  // following a "Generate all" click on the same page. Without this,
  // useState's lazy initializer would lock the local state to whatever
  // shape the page mounted with, so the page would need a full reload
  // before a freshly-queued job appeared.
  //
  // The signature key keeps the dependency stable when the array
  // reference is new but content hasn't actually changed.
  const initialSignature = initial.map((j) => `${j.id}:${j.status}:${j.imageUrl ?? ''}`).join('|');
  useEffect(() => {
    setJobs(initial.map(rehydrateDates));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSignature]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/products/image-jobs?siteId=${encodeURIComponent(siteId)}&productId=${encodeURIComponent(productId)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ImageJobRow[] };
      setJobs(data.jobs.map(rehydrateDates));
    } catch {
      // Ignore transient polling errors — the next tick will retry.
    }
  }, [siteId, productId]);

  // Poll while any job is non-terminal. We restart the timer whenever
  // the list shifts so a fresh kick (POST add) starts polling without
  // waiting for the next setInterval period to elapse.
  const hasActive = rawJobs.some((j) => j.status === 'pending' || j.status === 'running');
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      await refresh();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasActive, refresh]);

  // Listen for an external "kick poll" event so a sibling component
  // (e.g. RetryableGenerateButton on the same page) can ask us to start
  // polling immediately when the merchant clicks "Generate all" — even
  // before any image jobs land in our local state. We don't need a
  // shared context: a CustomEvent on window keeps the components
  // decoupled.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ siteId?: string; productId?: string }>).detail;
      if (detail?.siteId !== siteId || detail?.productId !== productId) {
        return;
      }
      // Run several spaced refreshes — kie image jobs typically appear
      // in the DB within ~1s of the click; we want to pick them up
      // even if the chat-field call is still blocking the route.
      let count = 0;
      const id = setInterval(async () => {
        count += 1;
        await refresh();
        if (count >= 6) clearInterval(id);
      }, 800);
    };
    window.addEventListener('oneshoplab:kick-image-poll', handler);
    return () => {
      window.removeEventListener('oneshoplab:kick-image-poll', handler);
    };
  }, [siteId, productId, refresh]);

  async function deleteJob(jobId: string) {
    setBusy((b) => ({ ...b, [jobId]: 'delete' }));
    try {
      await fetch(
        `/api/products/image-jobs?siteId=${encodeURIComponent(siteId)}&productId=${encodeURIComponent(productId)}&jobId=${encodeURIComponent(jobId)}`,
        { method: 'DELETE' }
      );
      // Optimistic removal — the refresh below will reconcile against
      // the server's authoritative list.
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      await refresh();
      // Cancelling a pending/running job triggers a credit refund on
      // the server (via persistKieJobFailure idempotency); calling
      // router.refresh() re-runs the layout's auth() so the header
      // credit chip + the per-page balance pick up the new total
      // without a manual reload.
      refreshKeepingScroll(() => router.refresh());
    } finally {
      setBusy((b) => {
        const { [jobId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  function openAddModal() {
    setModalReplaceId(null);
    setModalOpen(true);
  }

  function openRegenerateModal(jobId: string) {
    setModalReplaceId(jobId);
    setModalOpen(true);
  }

  async function submitNewImage(opts: {
    angle: ImageAngle;
    customPrompt: string;
    replaceJobId: string | null;
  }) {
    setErrorMsg(null);
    const res = await fetch('/api/products/image-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId,
        productId,
        angle: opts.angle,
        customPrompt: opts.customPrompt,
        replaceJobId: opts.replaceJobId
      })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setErrorMsg(t(errorKeyFromCode(body.error)));
      return false;
    }
    setModalOpen(false);
    await refresh();
    // Adding or regenerating an image debits credits — refresh the
    // page so the header chip + the per-page balance reflect the new
    // total. Same reason as the deleteJob path.
    refreshKeepingScroll(() => router.refresh());
    return true;
  }

  return {
    rawJobs,
    now,
    busy,
    errorMsg,
    modalOpen,
    modalReplaceId,
    closeModal: () => setModalOpen(false),
    deleteJob,
    openAddModal,
    openRegenerateModal,
    submitNewImage
  };
}
