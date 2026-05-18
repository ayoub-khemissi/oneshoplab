'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGenerateContext } from '@/components/retryable-generate';

/**
 * Module-level guard so a given productId can only ever auto-fire once
 * per tab session. A useRef alone isn't enough because React 19 + the
 * App Router can remount client components during a router transition,
 * which would reset the ref and let submit('all') fire a second time
 * (3 + 3 = 6 image jobs instead of 3). The Set survives those remounts.
 */
const firedProductIds = new Set<string>();

interface Props {
  productId: string;
}

/**
 * Triggers a one-shot "Generate all" right after the user lands on a
 * product page with `?autoOptimize=1` — wired from the "Créer et
 * optimiser" CTA on the manual product creation form. We fire through
 * the existing RetryableGenerateProvider so the user gets the same
 * spinner / retry / credit-check UX as a manual click.
 *
 * The query param is stripped via router.replace so the App Router's
 * useSearchParams reflects the removal — a plain history.replaceState
 * would only update the URL bar and useSearchParams would keep
 * returning autoOptimize=1 on the next render, defeating any "bail on
 * already-fired" check downstream.
 */
export function AutoOptimizeOnMount({ productId }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const ctx = useGenerateContext();

  useEffect(() => {
    if (params.get('autoOptimize') !== '1') return;
    // Belt-and-braces dedupe in case the component remounts before
    // router.replace has propagated.
    if (firedProductIds.has(productId)) return;
    firedProductIds.add(productId);

    // Strip the param via the App Router so useSearchParams stops
    // returning autoOptimize=1 on subsequent renders / remounts.
    const next = new URLSearchParams(params);
    next.delete('autoOptimize');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });

    // Hard gates (archived product, insufficient credits) — same
    // checks the manual button does, so the auto-fire respects the
    // same constraints.
    if (ctx.productArchived) return;
    if (!ctx.canAfford('all')) return;

    ctx.submit('all');
    // We intentionally don't list params/ctx/router/productId in deps
    // — this is a one-shot fire on mount; the firedProductIds Set
    // guards against accidental replays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
