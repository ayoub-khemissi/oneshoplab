'use client';

import {
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
import { useCallback, useEffect, useState } from 'react';
import {
  CREDIT_PACKS,
  PLAN_TIERS,
  SIGNUP_FREE_CREDITS,
  shopifyPackPrice,
  shopifyPlanPrice,
  type BillingCycle
} from '@/entities/ai-model';

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string>; toast?: { show: (msg: string) => void } };
  }
}

type ReadyState = {
  kind: 'ready';
  shop: string;
  shopName: string | null;
  billingChannel: 'stripe' | 'shopify';
  plan: string;
  cycle: string | null;
  subscriptionStatus: string | null;
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
};
type State = ReadyState | OnboardingState;

const PAID = PLAN_TIERS.filter((t) => t.id !== 'free');

async function call<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const token = window.shopify ? await window.shopify.idToken() : '';
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

function toast(msg: string) {
  window.shopify?.toast?.show(msg);
}

function scoreTone(score: number | null): string {
  if (score == null) return 'text-[var(--muted)]';
  return score < 50
    ? 'text-[var(--danger)]'
    : score < 75
      ? 'text-[var(--warning)]'
      : 'text-[var(--success)]';
}

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0 })}`;
}

function fetchState() {
  return call<State>('/api/shopify/app/state').catch(() => null);
}

export function EmbeddedApp({
  shopHint,
  contactEmail
}: {
  locale: string;
  shopHint: string | null;
  contactEmail: string;
}) {
  const t = useTranslations('ShopifyApp');
  const locale = useLocale();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [linkOpened, setLinkOpened] = useState(false);
  // The admin always opens the app URL with `?shop=`; without it we are not in Shopify.
  const inShopify = Boolean(shopHint);

  const applyState = useCallback((r: Awaited<ReturnType<typeof fetchState>>) => {
    if (!r || !r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setState(r.data);
    if (r.data.kind === 'ready' && r.data.cycle === 'yearly') setCycle('yearly');
  }, []);
  const load = useCallback(async () => applyState(await fetchState()), [applyState]);

  useEffect(() => {
    let alive = true;
    void fetchState().then((r) => {
      if (alive) applyState(r);
    });
    return () => {
      alive = false;
    };
  }, [applyState]);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(action + (body.plan ?? body.pack ?? ''));
    try {
      const r = await call<{ url?: string; confirmationUrl?: string; error?: string }>(
        `/api/shopify/app/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({ locale, ...body })
        }
      );
      if (!r.ok) {
        toast(t('actionFailed'));
        return;
      }
      if (r.data.confirmationUrl) {
        toast(t('redirecting'));
        window.open(r.data.confirmationUrl, '_top');
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

  if (!inShopify) {
    return (
      <Shell>
        <p className="text-sm text-[var(--muted)]">{t('outsideShopify')}</p>
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
        <Card className="max-w-xl">
          <div className="flex items-center gap-3">
            <Logo />
            <h1 className="text-xl font-semibold tracking-tight">{t('welcomeTitle')}</h1>
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t('welcomeBody')}</p>
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
  return (
    <Shell>
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
        <Button primary busy={busy === 'open'} onClick={() => void act('open')}>
          {t('openApp')} <ArrowUpRight className="size-4" aria-hidden />
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

      {s.billingChannel === 'shopify' ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{t('planTitle')}</h2>
                <p className="text-xs text-[var(--muted)]">{t('billedByShopify')}</p>
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
                {t('testMode', { cap: s.testCreditCap })}
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
              {PAID.map((tier) => {
                const current =
                  s.plan === tier.id &&
                  (s.cycle ?? 'monthly') === cycle &&
                  s.subscriptionStatus === 'active';
                const price = shopifyPlanPrice(tier.id as 'starter' | 'pro' | 'scale', cycle);
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
                      primary={!current}
                      disabled={current}
                      busy={busy === `subscribe${tier.id}`}
                      onClick={() => void act('subscribe', { plan: tier.id, cycle })}
                    >
                      {current ? t('currentPlan') : t('choosePlan')}
                    </Button>
                  </div>
                );
              })}
            </div>
            {s.plan !== 'free' && s.subscriptionStatus === 'active' ? (
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
                    {t('buyPack')} · ${shopifyPackPrice(p.id)}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-sm">{t('managedOnWeb')}</p>
          <Button onClick={() => void act('open')}>
            {t('manageOnWeb')} <ArrowUpRight className="size-4" aria-hidden />
          </Button>
        </Card>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">{children}</main>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm md:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

function Stat({
  icon,
  label,
  children
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-white p-3 shadow-sm">
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
        {icon}
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{children}</span>
    </div>
  );
}

function Button({
  children,
  onClick,
  primary = false,
  busy = false,
  disabled = false
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center justify-center gap-2 self-start rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
          : 'border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--default)]'
      }`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/osl-light.svg"
      alt="OneShopLab"
      width={36}
      height={36}
      className="size-9 rounded-lg"
    />
  );
}
