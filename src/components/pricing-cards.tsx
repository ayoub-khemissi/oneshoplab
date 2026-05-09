'use client';

import { Card } from '@heroui/react';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
// Import from the leaf module (no server-only deps) so this client bundle
// stays free of mysql2 / drizzle imports leaking through the @/lib/ai barrel.
import {
  PLAN_TIERS,
  YEARLY_DISCOUNT,
  yearlyMonthlyEquivalent,
  type BillingCycle,
  type PlanTier
} from '@/lib/ai/models';
import { createCheckoutSessionAction } from '@/lib/stripe-actions';

interface PricingCardsProps {
  signedIn: boolean;
  /** Per-(plan, cycle) availability flags from server: false → price not configured. */
  available: Record<string, boolean>;
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
  };
}

export function PricingCards({ signedIn, available, copy }: PricingCardsProps) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly');

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
            available={tier.id === 'free' ? true : available[`${tier.id}_${cycle}`] ?? false}
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
  copy
}: {
  tier: PlanTier;
  cycle: BillingCycle;
  signedIn: boolean;
  available: boolean;
  copy: PricingCardsProps['copy'];
}) {
  const isFree = tier.priceEur === 0;
  const isFeatured = tier.id === 'pro';

  // Monthly-equivalent display price for both cycles (yearly = -20%).
  const displayPrice =
    isFree
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
        <span className="text-2xl font-bold tabular-nums">
          {tier.credits.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--muted)]">
          ≈ {tier.approxFullGenerations.toLocaleString()} {copy.fullGenerations}
        </span>
      </div>

      <ul className="flex flex-col gap-2 text-sm">
        {tier.highlights.map((h, i) => (
          <li key={i} className="flex items-start gap-2 text-[var(--foreground)]">
            <Check className="size-4 text-[var(--success)] mt-0.5 shrink-0" />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      <CardCta
        tier={tier}
        cycle={cycle}
        signedIn={signedIn}
        available={available}
        copy={copy}
        isFeatured={isFeatured}
      />
      </Card>
    </div>
  );
}

function CardCta({
  tier,
  cycle,
  signedIn,
  available,
  copy,
  isFeatured
}: {
  tier: PlanTier;
  cycle: BillingCycle;
  signedIn: boolean;
  available: boolean;
  copy: PricingCardsProps['copy'];
  isFeatured: boolean;
}) {
  const baseClasses =
    'mt-auto px-4 py-2.5 rounded-md font-medium text-sm transition-opacity hover:opacity-90 text-center inline-flex items-center justify-center gap-1.5';
  const featuredClasses = 'bg-[var(--accent)] text-[var(--accent-foreground)]';
  const outlineClasses =
    'border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)]';

  if (tier.priceEur === 0) {
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
