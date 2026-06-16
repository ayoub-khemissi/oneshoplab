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
 *   ?ga=signup                                     -> sign_up / CompleteRegistration
 *   ?ga=login                                      -> login
 *   ?checkout=success&sid&plan&cycle&value&currency -> purchase / Purchase
 *   ?purchase=success&sid&pack&value&currency       -> purchase / Purchase
 *
 * GA `purchase` carries no client-side value on purpose — accurate
 * revenue belongs to the Stripe webhook (Measurement Protocol). The
 * Meta Pixel has no such server-side twin wired here, so the browser
 * `Purchase` event DOES carry value+currency (from the success URL) —
 * that's the only revenue signal Meta gets, and ROAS-based ad
 * optimization needs it.
 */
export function GaRedirectEvents() {
  const [beacon, setBeacon] = useState<{
    event: string;
    params?: Record<string, unknown>;
    onceKey?: string;
    /** Optional Meta Pixel standard-event twin fired alongside the GA event. */
    metaEvent?: string;
    /** Params for the Meta twin (e.g. value+currency on Purchase). */
    metaParams?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    const ga = q.get('ga');
    const checkout = q.get('checkout');
    const purchase = q.get('purchase');
    const sid = q.get('sid') ?? undefined;
    // Value/currency for the Meta Purchase event (set by the Stripe
    // success URLs). Parsed defensively — a malformed value just drops
    // out of the event params.
    const rawValue = q.get('value');
    const value = rawValue && Number.isFinite(Number(rawValue)) ? Number(rawValue) : undefined;
    const currency = (q.get('currency') ?? undefined)?.toLowerCase();
    const metaPurchaseParams =
      value != null ? { value, currency: currency ?? 'eur' } : undefined;

    let ev: typeof beacon = null;
    const consumed: string[] = [];

    // Fresh OAuth (Google) signup: the auth events.createUser hook drops
    // a one-shot `osl_new_signup` cookie because the Google round-trip
    // lands on a bare /dashboard with no `?ga=signup` marker. Read +
    // clear it here so a Google signup fires the same conversion events
    // as a credentials one. URL markers take priority (a credentials
    // signup will never have this cookie since it doesn't go through
    // the adapter's createUser).
    const hasOauthSignupCookie = /(?:^|;\s*)osl_new_signup=1(?:;|$)/.test(
      document.cookie
    );
    const clearOauthSignupCookie = () => {
      document.cookie = 'osl_new_signup=; max-age=0; path=/; samesite=lax';
    };

    if (ga === 'signup') {
      ev = {
        event: 'sign_up',
        params: { method: 'credentials' },
        metaEvent: 'CompleteRegistration'
      };
      consumed.push('ga');
    } else if (hasOauthSignupCookie) {
      ev = {
        event: 'sign_up',
        params: { method: 'google' },
        metaEvent: 'CompleteRegistration'
      };
      clearOauthSignupCookie();
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
        metaEvent: 'Purchase',
        metaParams: metaPurchaseParams,
        onceKey: sid ? `purchase-${sid}` : undefined
      };
      consumed.push('checkout', 'sid', 'plan', 'cycle', 'value', 'currency');
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
        metaEvent: 'Purchase',
        metaParams: metaPurchaseParams,
        onceKey: sid ? `purchase-${sid}` : undefined
      };
      consumed.push('purchase', 'sid', 'pack', 'value', 'currency');
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
          params={beacon.metaParams}
          onceKey={beacon.onceKey}
        />
      ) : null}
    </>
  );
}
