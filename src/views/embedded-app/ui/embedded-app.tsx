'use client';

import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gauge,
  ListChecks,
  Loader2,
  Package,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CREDIT_PACKS,
  PLAN_TIERS,
  SIGNUP_FREE_CREDITS,
  shopifyPackPrice,
  shopifyPlanPrice,
  wixPackPrice,
  wixPlanPrice,
  type BillingCycle
} from '@/entities/ai-model';
import type { EmbeddedHost } from '@/shared/embedded/client';
import { Button, Card, Logo, Shell, Stat } from './parts';

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string>; toast?: { show: (msg: string) => void } };
  }
}

type ReadyState = {
  kind: 'ready';
  shop: string;
  projectId: string;
  shopName: string | null;
  billingChannel: 'stripe' | 'shopify' | 'wix';
  plan: string;
  cycle: string | null;
  subscriptionStatus: string | null;
  /** Wix only: the plan was bought on another Wix site of the account. */
  planOnOtherSite?: boolean;
  credits: number;
  products: number;
  lastPullAtIso: string | null;
  pulling: boolean;
  score: number | null;
  pendingChanges: number;
  testCharges: boolean;
  testCreditCap: number;
};
type OnboardingState = {
  kind: 'onboarding';
  shop: string;
  shopName: string | null;
  email: string | null;
  emailTaken: boolean;
  /** Wix only: Wix Stores is not on the site. */
  storesMissing?: boolean;
};
type State = ReadyState | OnboardingState;
type PaidPlan = 'starter' | 'pro' | 'scale';

const PAID = PLAN_TIERS.filter((t) => t.id !== 'free');
const RANK = (plan: string) => PLAN_TIERS.findIndex((t) => t.id === plan);
/** Where a Wix user cancels an app plan (Wix bills; we cannot cancel for them). */
const WIX_SUBSCRIPTIONS_URL = 'https://manage.wix.com/account/subscriptions';

/**
 * What differs between the admins: where the session comes from, which API
 * answers, how a checkout opens, and the store's own prices.
 */
interface HostAdapter {
  api: string;
  /** Query parameter a document load carries the session in. */
  tokenParam: string;
  token(): Promise<string>;
  planPrice(plan: PaidPlan, cycle: BillingCycle): number;
  packPrice(pack: (typeof CREDIT_PACKS)[number]['id']): number;
}

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0 })}`;
}

function scoreTone(score: number | null): string {
  if (score == null) return 'text-[var(--muted)]';
  return score < 50
    ? 'text-[var(--danger)]'
    : score < 75
      ? 'text-[var(--warning)]'
      : 'text-[var(--success)]';
}

export function EmbeddedApp({
  host,
  shopHint,
  framed,
  contactEmail,
  wixToken = null
}: {
  host: EmbeddedHost;
  locale: string;
  shopHint: string | null;
  /** The document is framed (by the admin): true even when the URL names no store. */
  framed: boolean;
  contactEmail: string;
  /** Wix: our session token, minted by the page from Wix's signed instance. */
  wixToken?: string | null;
}) {
  const t = useTranslations('EmbeddedApp');
  const locale = useLocale();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [linkOpened, setLinkOpened] = useState(false);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wixTokenRef = useRef(wixToken);
  const wix = host === 'wix';
  // Shopify opens the app URL with `?shop=`; Wix with a signed instance.
  const inAdmin = wix ? Boolean(wixToken) : Boolean(shopHint) || framed;

  const adapter: HostAdapter = wix
    ? {
        api: '/api/wix/app',
        tokenParam: 'osl_token',
        token: async () => wixTokenRef.current ?? '',
        planPrice: wixPlanPrice,
        packPrice: wixPackPrice
      }
    : {
        api: '/api/shopify/app',
        tokenParam: 'id_token',
        token: async () => (window.shopify ? await window.shopify.idToken() : ''),
        planPrice: shopifyPlanPrice,
        packPrice: shopifyPackPrice
      };
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const call = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const token = await adapterRef.current.token();
    const res = await fetch(`${adapterRef.current.api}/${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  }, []);

  const toast = useCallback(
    (msg: string) => {
      if (!wix && window.shopify?.toast) window.shopify.toast.show(msg);
      else setNotice(msg);
    },
    [wix]
  );

  const applyState = useCallback((r: { ok: boolean; data: State } | null) => {
    if (!r || !r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setState(r.data);
    if (r.data.kind === 'ready' && r.data.cycle === 'yearly') setCycle('yearly');
  }, []);
  const fetchState = useCallback(() => call<State>('state').catch(() => null), [call]);
  const load = useCallback(async () => applyState(await fetchState()), [applyState, fetchState]);

  useEffect(() => {
    if (!inAdmin) return;
    let alive = true;
    void fetchState().then((r) => {
      if (alive) applyState(r);
    });
    return () => {
      alive = false;
    };
  }, [applyState, fetchState, inAdmin]);

  // Wix: renew our session before it expires; a checkout in another tab
  // brings the merchant back here, so read the state again on return.
  useEffect(() => {
    if (!wix || !inAdmin) return;
    const renew = setInterval(
      () => {
        void call<{ token?: string }>('session', { method: 'POST' }).then((r) => {
          if (r.ok && r.data.token) wixTokenRef.current = r.data.token;
        });
      },
      20 * 60 * 1000
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(renew);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [wix, inAdmin, call, load]);

  /**
   * The full app, in this same frame. A document load carries no Bearer
   * header: the session rides along in the URL, which the proxy turns into
   * the request's session (src/proxy.ts).
   */
  async function openInFrame(path: string, shop: string) {
    setBusy('open');
    const token = await adapter.token();
    const q = new URLSearchParams({ [adapter.tokenParam]: token });
    if (!wix) q.set('shop', shop);
    window.location.assign(`${path}?${q}`);
  }

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(action + (body.plan ?? body.pack ?? ''));
    setNotice(null);
    try {
      const r = await call<{
        url?: string;
        confirmationUrl?: string;
        checkoutUrl?: string;
        error?: string;
      }>(action, {
        method: 'POST',
        body: JSON.stringify({ locale, ...body })
      });
      if (!r.ok) {
        toast(r.data.error === 'downgrade' ? t('downgradeWix') : t('actionFailed'));
        return;
      }
      if (r.data.confirmationUrl) {
        toast(t('redirecting'));
        window.open(r.data.confirmationUrl, '_top');
        return;
      }
      if (r.data.checkoutUrl) {
        // Wix checkout opens in a new tab; back here, the state is read again.
        window.open(r.data.checkoutUrl, '_blank', 'noopener');
        setCheckoutOpened(true);
        return;
      }
      if (r.data.url) {
        window.open(r.data.url, '_blank', 'noopener');
        if (action === 'link') setLinkOpened(true);
        return;
      }
      if (action === 'sync') toast(t('syncRequested'));
      if (action === 'cancel') toast(t('canceled'));
      await load();
    } finally {
      setBusy(null);
    }
  }

  const noticeBar = notice ? (
    <p role="status" className="rounded-md bg-[var(--default)] px-3 py-2 text-sm">
      {notice}
    </p>
  ) : null;

  if (!inAdmin) {
    return (
      <Shell>
        <p className="text-sm text-[var(--muted)]">{wix ? t('outsideWix') : t('outsideShopify')}</p>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <Card>
          <h2 className="text-base font-semibold">{t('errorTitle')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('errorBody', { email: contactEmail })}</p>
          <Button onClick={() => void load()}>{t('retry')}</Button>
        </Card>
      </Shell>
    );
  }
  if (!state) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('loading')}
        </div>
      </Shell>
    );
  }

  if (state.kind === 'onboarding') {
    const canCreate = Boolean(state.email) && !state.emailTaken;
    return (
      <Shell>
        {noticeBar}
        <Card className="max-w-xl">
          <div className="flex items-center gap-3">
            <Logo />
            <h1 className="text-xl font-semibold tracking-tight">{t('welcomeTitle')}</h1>
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('welcomeBody')}</p>
          {state.storesMissing ? (
            <p className="flex items-start gap-2 rounded-md bg-[var(--warning)]/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
              {t('storesMissingWix')}
            </p>
          ) : null}
          {canCreate ? (
            <>
              <p className="text-sm">
                {t('createSpaceBody', { email: state.email ?? '', credits: SIGNUP_FREE_CREDITS })}
              </p>
              <Button primary busy={busy === 'onboard'} onClick={() => void act('onboard')}>
                <Sparkles className="size-4" aria-hidden /> {t('createSpace')}
              </Button>
              <p className="text-xs text-[var(--muted)]">
                {t.rich('legal', {
                  terms: (c) => (
                    <a
                      className="underline"
                      href={`/${locale}/terms`}
                      target="_blank"
                      rel="noopener"
                    >
                      {c}
                    </a>
                  ),
                  privacy: (c) => (
                    <a
                      className="underline"
                      href={`/${locale}/privacy`}
                      target="_blank"
                      rel="noopener"
                    >
                      {c}
                    </a>
                  )
                })}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">
                {state.emailTaken ? t('accountExistsTitle') : t('linkTitle')}
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {state.emailTaken
                  ? t('accountExistsBody', { email: state.email ?? '' })
                  : t('noEmailBody')}
              </p>
              <Button primary busy={busy === 'link'} onClick={() => void act('link')}>
                {t('linkAccount')} <ArrowUpRight className="size-4" aria-hidden />
              </Button>
              {linkOpened ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-[var(--muted)]">{t('linkOpened')}</span>
                  <Button onClick={() => void load()}>{t('linkDone')}</Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </Shell>
    );
  }

  const s = state;
  const lastSync = s.lastPullAtIso ? new Date(s.lastPullAtIso).toLocaleString(locale) : null;
  const planName = PLAN_TIERS.find((p) => p.id === s.plan)?.name ?? t('freePlan');
  const billedHere = s.billingChannel === host;
  const paidActive = s.plan !== 'free' && s.subscriptionStatus === 'active';
  return (
    <Shell>
      {noticeBar}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {s.shopName ?? s.shop}
            </h1>
            <p className="text-xs text-[var(--muted)]">{t('planCurrent', { plan: planName })}</p>
          </div>
        </div>
        <Button
          primary
          busy={busy === 'open'}
          onClick={() => void openInFrame(`/${locale}/dashboard/sites/${s.projectId}`, s.shop)}
        >
          {t('openApp')} <ArrowRight className="size-4" aria-hidden />
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<Gauge className="size-4" aria-hidden />} label={t('scoreLabel')}>
          <span className={scoreTone(s.score)}>
            {s.score == null ? t('scorePending') : `${s.score}/100`}
          </span>
        </Stat>
        <Stat icon={<Package className="size-4" aria-hidden />} label={t('productsLabel')}>
          {s.products.toLocaleString(locale)}
        </Stat>
        <Stat icon={<ListChecks className="size-4" aria-hidden />} label={t('pendingLabel')}>
          {s.pendingChanges.toLocaleString(locale)}
        </Stat>
        <Stat icon={<Coins className="size-4" aria-hidden />} label={t('creditsLabel')}>
          {s.credits.toLocaleString(locale)}
        </Stat>
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('syncTitle')}</h2>
            <p className="text-sm text-[var(--muted)]">
              {s.pulling
                ? t('syncing')
                : lastSync
                  ? t('lastSync', { date: lastSync })
                  : t('neverSynced')}
            </p>
          </div>
          <Button busy={busy === 'sync'} disabled={s.pulling} onClick={() => void act('sync')}>
            <RefreshCw className="size-4" aria-hidden /> {t('syncNow')}
          </Button>
        </div>
        <p className="text-sm text-[var(--muted)]">{t('openAppHint')}</p>
      </Card>

      {billedHere && !s.planOnOtherSite ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{t('planTitle')}</h2>
                <p className="text-xs text-[var(--muted)]">
                  {wix ? t('billedByWix') : t('billedByShopify')}
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-[var(--default)] p-1 text-sm" role="group">
                {(['monthly', 'yearly'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={cycle === c}
                    onClick={() => setCycle(c)}
                    className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                      cycle === c
                        ? 'bg-white shadow-sm text-[var(--foreground)]'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    {c === 'monthly' ? t('cycleMonthly') : t('cycleYearly')}
                    {c === 'yearly' ? (
                      <span className="ml-1.5 text-xs text-[var(--success)]">
                        {t('yearlySave')}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {s.testCharges ? (
              <p className="rounded-md bg-[var(--default)] px-3 py-2 text-xs text-[var(--muted)]">
                {wix
                  ? t('testModeWix', { cap: s.testCreditCap })
                  : t('testMode', { cap: s.testCreditCap })}
              </p>
            ) : null}
            {checkoutOpened ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-[var(--muted)]">{t('checkoutOpened')}</span>
                <Button onClick={() => void load()}>{t('linkDone')}</Button>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
              {PAID.map((tier) => {
                const current =
                  s.plan === tier.id && (s.cycle ?? 'monthly') === cycle && paidActive;
                // Wix bills a lower plan (or yearly → monthly) as a cancellation
                // plus a new purchase: that goes through Wix, not this page.
                const lower =
                  wix &&
                  paidActive &&
                  (RANK(tier.id) < RANK(s.plan) ||
                    (tier.id === s.plan && s.cycle === 'yearly' && cycle === 'monthly'));
                const price = adapter.planPrice(tier.id as PaidPlan, cycle);
                return (
                  <div
                    key={tier.id}
                    className={`flex flex-col gap-2 rounded-xl border p-4 ${
                      tier.id === 'pro' ? 'border-[var(--accent)]' : 'border-[var(--border)]'
                    } bg-white`}
                  >
                    <span className="text-sm font-semibold">{tier.name}</span>
                    {/* Like the site: yearly shows its monthly equivalent, the
                        yearly total underneath. */}
                    <span className="text-2xl font-bold tracking-tight">
                      {usd(cycle === 'yearly' ? Math.round((price / 12) * 100) / 100 : price)}
                      <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                        {t('perMonth')}
                      </span>
                    </span>
                    {cycle === 'yearly' ? (
                      <span className="-mt-1 text-xs text-[var(--muted)]">
                        {t('billedYearly', { price: usd(price) })}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                      <Coins className="size-3" aria-hidden />{' '}
                      {t('creditsPerMonth', { credits: tier.credits })}
                    </span>
                    <Button
                      primary={!current && !lower}
                      disabled={current || lower}
                      busy={busy === `subscribe${tier.id}`}
                      onClick={() => void act('subscribe', { plan: tier.id, cycle })}
                    >
                      {current ? t('currentPlan') : t('choosePlan')}
                    </Button>
                  </div>
                );
              })}
            </div>
            {paidActive && wix ? (
              <p className="text-xs text-[var(--muted)]">
                {t('downgradeWix')}{' '}
                <a
                  className="underline underline-offset-2"
                  href={WIX_SUBSCRIPTIONS_URL}
                  target="_blank"
                  rel="noopener"
                >
                  {t('manageInWix')}
                </a>
              </p>
            ) : null}
            {paidActive && !wix ? (
              <button
                type="button"
                className="self-start text-xs text-[var(--muted)] underline underline-offset-2"
                onClick={() => {
                  if (window.confirm(t('cancelConfirm'))) void act('cancel');
                }}
              >
                {t('cancelPlan')}
              </button>
            ) : null}
          </Card>

          <Card>
            <div>
              <h2 className="text-base font-semibold">{t('packsTitle')}</h2>
              <p className="text-xs text-[var(--muted)]">{t('packsHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {CREDIT_PACKS.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-white p-3"
                >
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className="inline-flex items-center gap-1 text-sm">
                    <Coins className="size-3.5 text-[var(--accent)]" aria-hidden />{' '}
                    {t('packCredits', { credits: p.credits })}
                  </span>
                  <Button
                    busy={busy === `purchase${p.id}`}
                    onClick={() => void act('purchase', { pack: p.id })}
                  >
                    {t('buyPack')} · {usd(adapter.packPrice(p.id))}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-sm">
            {s.planOnOtherSite
              ? t('planOnOtherSiteWix')
              : s.billingChannel === 'stripe'
                ? t('managedOnWeb')
                : t('managedElsewhere')}
          </p>
        </Card>
      )}
    </Shell>
  );
}
