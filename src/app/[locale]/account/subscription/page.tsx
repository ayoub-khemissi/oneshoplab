import { Card } from '@heroui/react';
import { eq } from 'drizzle-orm';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Coins,
  CreditCard,
  ExternalLink,
  Info,
  Sparkles
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { PLAN_TIERS } from '@/lib/ai/models';
import { auth } from '@/lib/auth';
import { getCreditBuckets } from '@/lib/credits';
import { db } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { createPortalSessionAction } from '@/lib/stripe-actions';
import { formatDate } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<
  string,
  { tone: 'success' | 'warning' | 'danger' | 'muted'; key: string }
> = {
  active: { tone: 'success', key: 'statusActive' },
  trialing: { tone: 'success', key: 'statusTrialing' },
  cancelling: { tone: 'warning', key: 'statusCancelling' },
  past_due: { tone: 'danger', key: 'statusPastDue' },
  canceled: { tone: 'muted', key: 'statusCanceled' },
  pending: { tone: 'muted', key: 'statusPending' },
  unpaid: { tone: 'danger', key: 'statusUnpaid' }
};

export default async function SubscriptionPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const t = await getTranslations('Subscription');
  const locale = await getLocale();

  const [sub, buckets] = await Promise.all([
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, session.user.id)
    }),
    getCreditBuckets(session.user.id)
  ]);

  const plan = session.user.plan ?? 'free';
  const planTier = PLAN_TIERS.find((p) => p.id === plan);
  const planName = planTier?.name ?? 'Free';
  const isPaid = plan !== 'free' && sub?.stripeCustomerId;

  const status = sub?.status ?? 'active';
  const statusInfo = STATUS_TONE[status] ?? { tone: 'muted', key: 'statusUnknown' };
  const statusLabel = t(statusInfo.key);

  const periodEnd = sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : null;

  const cycleLabel =
    sub?.billingCycle === 'yearly'
      ? t('cycleYearly')
      : sub?.billingCycle === 'monthly'
        ? t('cycleMonthly')
        : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">{t('subtitle')}</p>
      </header>

      {/* Status banner — surfaced for any non-active state so the merchant
          can't miss a cancellation, past-due or suspension. The plan card
          below still carries the StatusPill, but the banner is the
          impossible-to-overlook signal. */}
      <StatusBanner status={status} planName={planName} periodEnd={periodEnd} t={t} />

      {/* Plan + status overview ------------------------------------------- */}
      <Card variant="secondary" className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('currentPlanLabel')}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{planName}</span>
              {cycleLabel ? (
                <span className="text-sm text-[var(--muted)]">· {cycleLabel}</span>
              ) : null}
            </div>
          </div>
          <StatusPill tone={statusInfo.tone} label={statusLabel} />
        </div>

        {periodEnd ? (
          <p className="text-xs text-[var(--muted)]">
            {status === 'cancelling' || status === 'canceled'
              ? t('endsOn', { date: periodEnd })
              : t('renewsOn', { date: periodEnd })}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium"
          >
            <Sparkles className="size-3.5" aria-hidden />
            {plan === 'free' ? t('chooseAPlan') : t('changePlan')}
          </Link>
          {isPaid ? (
            <form action={createPortalSessionAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors text-sm font-medium"
              >
                <CreditCard className="size-3.5" aria-hidden />
                {t('manageBilling')}
                <ExternalLink className="size-3" aria-hidden />
              </button>
            </form>
          ) : null}
        </div>
        {isPaid ? <p className="text-xs text-[var(--muted)]">{t('manageBillingHint')}</p> : null}
      </Card>

      {/* Credits balance --------------------------------------------------- */}
      <Card variant="secondary" className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('balanceLabel')}
            </span>
            <span className="text-3xl font-bold tabular-nums inline-flex items-center gap-2">
              <Coins className="size-7 text-[var(--accent)]" aria-hidden />
              {buckets.total.toLocaleString(locale)}
            </span>
          </div>
          <Link
            href="/account/credits"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium"
          >
            {t('buyMore')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <BucketChip
            label={t('bucketSubscription')}
            value={buckets.subscription}
            hint={t('bucketSubscriptionHint')}
            tone="accent"
            locale={locale}
          />
          <BucketChip
            label={t('bucketPack')}
            value={buckets.pack}
            hint={t('bucketPackHint')}
            tone="success"
            locale={locale}
          />
        </div>
      </Card>
    </div>
  );
}

function StatusPill({
  tone,
  label
}: {
  tone: 'success' | 'warning' | 'danger' | 'muted';
  label: string;
}) {
  const cls = {
    success: 'bg-[var(--success)]/10 text-[var(--success)]',
    warning: 'bg-[var(--warning)]/10 text-[var(--warning)]',
    danger: 'bg-[var(--danger)]/10 text-[var(--danger)]',
    muted: 'bg-[var(--default)] text-[var(--muted)]'
  }[tone];
  return (
    <span
      className={`text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * Top-of-page banner shown for non-active subscription states. Returns
 * null for `active` / `trialing` (the StatusPill on the card is enough)
 * and for unknown statuses we'd rather not invent copy for.
 */
function StatusBanner({
  status,
  planName,
  periodEnd,
  t
}: {
  status: string;
  planName: string;
  periodEnd: string | null;
  t: Awaited<ReturnType<typeof getTranslations<'Subscription'>>>;
}) {
  type BannerSpec = {
    tone: 'warning' | 'danger' | 'muted';
    icon: typeof AlertTriangle;
    title: string;
    body: string;
  };
  let spec: BannerSpec | null = null;
  switch (status) {
    case 'cancelling':
      spec = {
        tone: 'warning',
        icon: CalendarClock,
        title: t('bannerCancellingTitle'),
        body: t('bannerCancellingBody', {
          plan: planName,
          date: periodEnd ?? '—'
        })
      };
      break;
    case 'canceled':
      spec = {
        tone: 'muted',
        icon: Info,
        title: t('bannerCanceledTitle'),
        body: t('bannerCanceledBody')
      };
      break;
    case 'past_due':
      spec = {
        tone: 'danger',
        icon: AlertTriangle,
        title: t('bannerPastDueTitle'),
        body: t('bannerPastDueBody')
      };
      break;
    case 'unpaid':
      spec = {
        tone: 'danger',
        icon: AlertTriangle,
        title: t('bannerUnpaidTitle'),
        body: t('bannerUnpaidBody')
      };
      break;
  }
  if (!spec) return null;
  const Icon = spec.icon;
  const toneCls = {
    warning: 'border-[var(--warning)]/40 bg-[var(--warning)]/5 text-[var(--warning)]',
    danger: 'border-[var(--danger)]/40 bg-[var(--danger)]/5 text-[var(--danger)]',
    muted: 'border-[var(--border)] bg-[var(--default)]/40 text-[var(--muted)]'
  }[spec.tone];
  return (
    <div role="alert" className={`flex items-start gap-3 p-4 rounded-md border ${toneCls}`}>
      <Icon className="size-5 mt-0.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-[var(--foreground)]">{spec.title}</span>
        <span className="text-sm text-[var(--muted)] leading-relaxed">{spec.body}</span>
      </div>
    </div>
  );
}

function BucketChip({
  label,
  value,
  hint,
  tone,
  locale
}: {
  label: string;
  value: number;
  hint: string;
  tone: 'accent' | 'success';
  locale: string;
}) {
  const dot = tone === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--default)]">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-mono font-semibold tabular-nums inline-flex items-center gap-1">
        <Coins className="size-3.5 text-[var(--accent)]" aria-hidden />
        {value.toLocaleString(locale)}
      </span>
      <span className="text-[var(--muted)] hidden sm:inline">·</span>
      <span className="text-[var(--muted)] hidden sm:inline">{hint}</span>
    </div>
  );
}
