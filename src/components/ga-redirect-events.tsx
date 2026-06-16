'use client';

import { useEffect, useState } from 'react';
import { TrackEvent } from '@/components/track-event';
import { MetaPixelEvent } from '@/components/meta-pixel-track';

/**
 * Fires the conversion event(s) encoded in the post-redirect URL, then
 * strips the marker query params (history.replaceState — no navigation,
 * no RSC refetch) so a refresh / back never double-counts. This is the one
 * place that reads + strips the markers, so it also dispatches the Meta Pixel
 * twin (e.g. signup → GA `sign_up` + Meta `CompleteRegistration`) to avoid a
 * read/strip race between separate components.
 *
 * All our auth + payment flows finish with a full-document redirect
 * (NextAuth signIn redirectTo, Stripe success_url), so reading
 * window.location once on mount is sufficient and avoids the
 * useSearchParams() Suspense/CSR-bailout caveat.
 *
 *   ?ga=signup                                     -> sign_up
 *   ?ga=login                                      -> login
 *   ?checkout=success&sid&plan&cycle  (Stripe sub) -> purchase
 *   ?purchase=success&sid&pack       (Stripe pack) -> purchase
 *
 * No `value` is sent client-side on purpose — accurate revenue belongs
 * to the Stripe webhook (Measurement Protocol) where the amount is the
 * source of truth; this only counts the conversion.
 */
export function GaRedirectEvents() {
  const [beacon, setBeacon] = useState<{
    event: string;
    params?: Record<string, unknown>;
    onceKey?: string;
    /** Optional Meta Pixel standard-event twin fired alongside the GA event. */
    metaEvent?: string;
  } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    const ga = q.get('ga');
    const checkout = q.get('checkout');
    const purchase = q.get('purchase');
    const sid = q.get('sid') ?? undefined;

    let ev: typeof beacon = null;
    const consumed: string[] = [];

    if (ga === 'signup') {
      ev = {
        event: 'sign_up',
        params: { method: 'credentials' },
        metaEvent: 'CompleteRegistration'
      };
      consumed.push('ga');
    } else if (ga === 'login') {
      ev = { event: 'login', params: { method: 'credentials' } };
      consumed.push('ga');
    } else if (checkout === 'success') {
      const plan = q.get('plan') ?? undefined;
      const cycle = q.get('cycle') ?? undefined;
      ev = {
        event: 'purchase',
        params: {
          transaction_id: sid,
          ...(plan
            ? {
                items: [
                  {
                    item_id: `plan_${plan}`,
                    item_name: `Subscription ${plan}${cycle ? ` (${cycle})` : ''}`,
                    item_category: 'subscription'
                  }
                ]
              }
            : {})
        },
        onceKey: sid ? `purchase-${sid}` : undefined
      };
      consumed.push('checkout', 'sid', 'plan', 'cycle');
    } else if (purchase === 'success') {
      const pack = q.get('pack') ?? undefined;
      ev = {
        event: 'purchase',
        params: {
          transaction_id: sid,
          ...(pack
            ? {
                items: [
                  {
                    item_id: `pack_${pack}`,
                    item_name: `Credit pack ${pack}`,
                    item_category: 'credit_pack'
                  }
                ]
              }
            : {})
        },
        onceKey: sid ? `purchase-${sid}` : undefined
      };
      consumed.push('purchase', 'sid', 'pack');
    }

    if (!ev) return;
    setBeacon(ev);

    let changed = false;
    for (const k of consumed) {
      if (q.has(k)) {
        q.delete(k);
        changed = true;
      }
    }
    if (changed) {
      const next = url.pathname + (url.search ? url.search : '') + url.hash;
      window.history.replaceState(window.history.state, '', next);
    }
  }, []);

  if (!beacon) return null;
  return (
    <>
      <TrackEvent
        event={beacon.event}
        params={beacon.params}
        onceKey={beacon.onceKey}
      />
      {beacon.metaEvent ? (
        <MetaPixelEvent
          event={beacon.metaEvent}
          onceKey={beacon.onceKey}
        />
      ) : null}
    </>
  );
}
