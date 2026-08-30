'use client';

import { Card } from '@heroui/react';
import { Check, Coins } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
// Import from the leaf module (no server-only deps) so this client bundle
// stays free of mysql2 / drizzle imports leaking through a server barrel.
import {
  imageRetentionDaysForPlan,
  PLAN_TIERS,
  YEARLY_DISCOUNT,
  yearlyMonthlyEquivalent,
  type BillingCycle,
  type PlanId,
  type PlanTier
} from '@/entities/ai-model';
import { createCheckoutSessionAction, createPortalSessionAction } from '../api/actions';

/** Plan ranks for upgrade/downgrade detection. The order mirrors the
 *  PLAN_IDS source-of-truth in pricing.ts. */
const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  scale: 3
};

interface PricingCardsProps {
  signedIn: boolean;
  /** Per-(plan, cycle) availability flags from server: false → price not configured. */
  available: Record<string, boolean>;
  /** The user's current subscription state. Drives the per-card CTA so a
   *  Pro subscriber sees "Current plan" on Pro and "Upgrade" / "Downgrade"
   *  on Scale / Starter, instead of a uniform "Subscribe". */
  current?: {
    plan: PlanId;
    cycle: BillingCycle | null;
    /** Treated as no-active-subscription when 'canceled' (the period
     *  ended). 'cancelling' / 'past_due' / 'unpaid' still count as
     *  having a live plan that the merchant should be able to manage. */
    status: string;
  } | null;
  copy: {
    perMonth: string;
    perMonthBilledYearly: string;
    signupOnce: string;
    monthlyCredits: string;
    signupCredits: string;
    fullGenerations: string;
    mostPopular: string;
    saveYearly: string;
    cycleMonthly: string;
    cycleYearly: string;
    ctaStartFree: string;
    ctaSubscribe: string;
    ctaGoToDashboard: string;
    ctaUnavailable: string;
    ctaCurrentPlan: string;
    ctaSwitchToMonthly: string;
    ctaSwitchToYearly: string;
    ctaUpgrade: string;
    ctaDowngrade: string;
  };
}

export function PricingCards({ signedIn, available, current, copy }: PricingCardsProps) {
  // Default the cycle toggle to whatever the merchant is already on so the
  // page lands with their current plan visually highlighted as "Current
  // plan" rather than offering a cycle they didn't pick.
  const initialCycle: BillingCycle = current?.cycle ?? 'yearly';
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  return (
    <>
      <div className="flex justify-center">
        <CycleToggle
          cycle={cycle}
          onChange={setCycle}
          monthlyLabel={copy.cycleMonthly}
          yearlyLabel={copy.cycleYearly}
          discountLabel={copy.saveYearly}
        />
      </div>
      <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLAN_TIERS.map((tier) => (
          <PlanCard
            key={tier.id}
            tier={tier}
            cycle={cycle}
            signedIn={signedIn}
            available={tier.id === 'free' ? true : (available[`${tier.id}_${cycle}`] ?? false)}
            current={current}
            copy={copy}
          />
        ))}
      </section>
    </>
  );
}

function CycleToggle({
  cycle,
  onChange,
  monthlyLabel,
  yearlyLabel,
  discountLabel
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
  monthlyLabel: string;
  yearlyLabel: string;
  discountLabel: string;
}) {
  const baseBtn =
    'px-4 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-2';
  const active = 'bg-[var(--accent)] text-[var(--accent-foreground)]';
  const idle = 'text-[var(--muted)] hover:text-[var(--foreground)]';
  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-[var(--default)] p-1">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`${baseBtn} ${cycle === 'monthly' ? active : idle}`}
        aria-pressed={cycle === 'monthly'}
      >
        {monthlyLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        className={`${baseBtn} ${cycle === 'yearly' ? active : idle}`}
        aria-pressed={cycle === 'yearly'}
      >
        {yearlyLabel}
        <span
          className={`text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded ${
            cycle === 'yearly'
              ? 'bg-white/20 text-[var(--accent-foreground)]'
              : 'bg-[var(--success)]/15 text-[var(--success)]'
          }`}
        >
          {discountLabel}
        </span>
      </button>
    </div>
  );
}

function PlanCard({
  tier,
  cycle,
  signedIn,
  available,
  current,
  copy
}: {
  tier: PlanTier;
  cycle: BillingCycle;
  signedIn: boolean;
  available: boolean;
  current: PricingCardsProps['current'];
  copy: PricingCardsProps['copy'];
}) {
  // Format numbers with the next-intl locale (same value SSR + client,
  // sourced from the URL/provider) instead of the runtime default,
  // which differs between Node (server) and the browser → React #418
  // hydration text mismatch.
  const locale = useLocale();
  const isFree = tier.priceEur === 0;
  const isFeatured = tier.id === 'pro';

  // Monthly-equivalent display price for both cycles (yearly = -20%).
  const displayPrice = isFree
    ? 0
    : cycle === 'yearly'
      ? yearlyMonthlyEquivalent(tier.priceEur)
      : tier.priceEur;

  return (
    <div className="relative flex">
      {isFeatured ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold whitespace-nowrap shadow-sm">
          {copy.mostPopular}
        </span>
      ) : null}
      <Card
        variant={isFeatured ? 'tertiary' : 'secondary'}
        className={`p-6 flex flex-col gap-5 w-full ${
          isFeatured ? 'border-2 border-[var(--accent)]' : ''
        }`}
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold tracking-tight">{tier.name}</h3>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-bold">
              €{displayPrice.toFixed(displayPrice % 1 === 0 ? 0 : 2)}
            </span>
            {tier.recurring ? (
              <span className="text-sm text-[var(--muted)]">/ {copy.perMonth}</span>
            ) : (
              <span className="text-sm text-[var(--muted)]">{copy.signupOnce}</span>
            )}
          </div>
          {tier.recurring && cycle === 'yearly' ? (
            <span className="text-xs text-[var(--muted)] font-mono">
              {copy.perMonthBilledYearly}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--muted)]">
            {tier.recurring ? copy.monthlyCredits : copy.signupCredits}
          </span>
          <span className="text-2xl font-bold tabular-nums inline-flex items-center gap-1.5">
            <Coins className="size-5 text-[var(--accent)]" aria-hidden />
            {tier.credits.toLocaleString(locale)}
          </span>
          <span className="text-xs text-[var(--muted)]">
            ≈ {tier.approxFullGenerations.toLocaleString(locale)} {copy.fullGenerations}
          </span>
        </div>

        <PlanHighlights tier={tier} />

        <CardCta
          tier={tier}
          cycle={cycle}
          signedIn={signedIn}
          available={available}
          current={current}
          copy={copy}
          isFeatured={isFeatured}
        />
      </Card>
    </div>
  );
}

/**
 * Localized list of bullet points under a plan card. Composes the
 * dynamic items (credits, stores, generations, re-audits) from the
 * tier's structured fields plus the per-plan extras (allModels,
 * priorityGen, …) by their stable id, all routed through next-intl.
 *
 * Lives inside the client bundle so we get ICU plural rules per locale
 * (1 store / # stores) without having to precompute strings server-side.
 */
function PlanHighlights({ tier }: { tier: PlanTier }) {
  const t = useTranslations('Pricing.highlightExtras');
  const tDyn = useTranslations('Pricing.highlightDynamic');

  const items: string[] = [];
  // Monthly recurring plans phrase the credit grant differently from
  // the one-shot signup grant on the free tier.
  items.push(
    tier.recurring
      ? tDyn('creditsRecurring', { credits: tier.credits })
      : tDyn('creditsOneShot', { credits: tier.credits })
  );
  items.push(tDyn('stores', { count: tier.siteLimit }));
  if (tier.approxFullGenerations > 0) {
    items.push(tDyn('generations', { count: tier.approxFullGenerations }));
  }
  items.push(tDyn('reaudits', { count: tier.siteLimit }));
  // Per-plan image retention — Free/Starter 30d, Pro 60d, Scale 90d.
  // Enforced by the R2 cleanup worker; the bullet is honest.
  items.push(
    tDyn('imageRetention', {
      days: imageRetentionDaysForPlan(tier.id)
    })
  );
  for (const extra of tier.highlightExtras) {
    items.push(t(extra));
  }

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-[var(--foreground)]">
          <Check className="size-4 text-[var(--success)] mt-0.5 shrink-0" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function CardCta({
  tier,
  cycle,
  signedIn,
  available,
  current,
  copy,
  isFeatured
}: {
  tier: PlanTier;
  cycle: BillingCycle;
  signedIn: boolean;
  available: boolean;
  current: PricingCardsProps['current'];
  copy: PricingCardsProps['copy'];
  isFeatured: boolean;
}) {
  const baseClasses =
    'mt-auto px-4 py-2.5 rounded-md font-medium text-sm transition-opacity hover:opacity-90 text-center inline-flex items-center justify-center gap-1.5';
  const featuredClasses = 'bg-[var(--accent)] text-[var(--accent-foreground)]';
  const outlineClasses =
    'border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)]';

  // A 'canceled' subscription means the period ended and access was lost —
  // treat the user as if they had no live subscription so they can pick
  // any plan as a fresh checkout. Other states (active, trialing,
  // cancelling, past_due, unpaid) all count as "still on a paid plan"
  // for the purpose of this UI: changes go through the customer portal.
  const hasLiveSubscription = !!current && current.plan !== 'free' && current.status !== 'canceled';
  const isCurrentPlan = hasLiveSubscription && current!.plan === tier.id;
  const isCurrentCycle = isCurrentPlan && current!.cycle === cycle;

  if (tier.priceEur === 0) {
    // Free tier card. Behavior splits on whether the user is on a paid
    // plan (then this card is "downgrade to free" → portal) versus a
    // free user (existing CTA).
    if (hasLiveSubscription) {
      return (
        <form action={createPortalSessionAction} className="contents">
          <button type="submit" className={`${baseClasses} ${outlineClasses}`}>
            {copy.ctaDowngrade}
          </button>
        </form>
      );
    }
    const href = signedIn ? '/dashboard' : '/signup';
    return (
      <Link
        href={href}
        className={`${baseClasses} ${isFeatured ? featuredClasses : outlineClasses}`}
      >
        {signedIn ? copy.ctaGoToDashboard : copy.ctaStartFree}
      </Link>
    );
  }

  if (!available) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClasses} ${outlineClasses} opacity-50 cursor-not-allowed`}
        title="Plan not yet available"
      >
        {copy.ctaUnavailable}
      </button>
    );
  }

  // Same plan, same cycle: this is the merchant's current subscription.
  // No change to be made — disabled "Current plan" button.
  if (isCurrentCycle) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClasses} ${
          isFeatured ? featuredClasses : outlineClasses
        } opacity-60 cursor-not-allowed`}
      >
        {copy.ctaCurrentPlan}
      </button>
    );
  }

  // Same plan, different cycle: route through the customer portal so
  // Stripe can pro-rate the cycle swap. We don't want to spin up a
  // brand-new checkout session against an existing active sub — that
  // would create a second subscription rather than replace.
  if (isCurrentPlan && !isCurrentCycle) {
    const label = cycle === 'yearly' ? copy.ctaSwitchToYearly : copy.ctaSwitchToMonthly;
    return (
      <form action={createPortalSessionAction} className="contents">
        <button
          type="submit"
          className={`${baseClasses} ${isFeatured ? featuredClasses : outlineClasses}`}
        >
          {label}
        </button>
      </form>
    );
  }

  if (!signedIn) {
    const href = `/signup?next=${encodeURIComponent(`/pricing?plan=${tier.id}&cycle=${cycle}`)}`;
    return (
      <Link
        href={href}
        className={`${baseClasses} ${isFeatured ? featuredClasses : outlineClasses}`}
      >
        {copy.ctaSubscribe}
      </Link>
    );
  }

  // Paid user looking at a different paid plan: portal handles
  // upgrade/downgrade with proration. Label depends on direction.
  if (hasLiveSubscription) {
    const isUpgrade = PLAN_RANK[tier.id] > PLAN_RANK[current!.plan];
    return (
      <form action={createPortalSessionAction} className="contents">
        <button
          type="submit"
          className={`${baseClasses} ${isFeatured ? featuredClasses : outlineClasses}`}
        >
          {isUpgrade ? copy.ctaUpgrade : copy.ctaDowngrade}
        </button>
      </form>
    );
  }

  // Free or canceled user, paid plan card → fresh checkout session.
  return (
    <form action={createCheckoutSessionAction} className="contents">
      <input type="hidden" name="plan" value={tier.id} />
      <input type="hidden" name="cycle" value={cycle} />
      <button
        type="submit"
        className={`${baseClasses} ${isFeatured ? featuredClasses : outlineClasses}`}
      >
        {copy.ctaSubscribe}
      </button>
    </form>
  );
}

export { YEARLY_DISCOUNT };
