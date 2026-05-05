import { Card } from '@heroui/react';
import { CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { CREDIT_PACKS } from '@/lib/ai/models';
import { auth } from '@/lib/auth';
import { getCreditBuckets } from '@/lib/credits';
import { buyCreditPackAction } from '@/lib/stripe-actions';
import { getStripePackPriceId } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ purchase?: string; error?: string }>;
}

export default async function AccountCreditsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/account/credits');

  const params = await searchParams;
  const t = await getTranslations('Credits');

  const buckets = await getCreditBuckets(session.user.id);
  const banner =
    params.purchase === 'success'
      ? { kind: 'success' as const, text: t('purchaseSuccess') }
      : params.purchase === 'cancelled'
        ? { kind: 'info' as const, text: t('purchaseCancelled') }
        : params.error === 'invalid_pack'
          ? { kind: 'error' as const, text: t('errorInvalidPack') }
          : params.error === 'price_not_configured'
            ? { kind: 'error' as const, text: t('errorPriceNotConfigured') }
            : params.error === 'stripe_failed'
              ? { kind: 'error' as const, text: t('errorStripeFailed') }
              : null;

  return (
    <main className="px-6 md:px-10 pb-10 max-w-4xl w-full mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2 mt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl leading-relaxed">
          {t('subtitle')}
        </p>
      </header>

      {banner ? (
        <div
          role={banner.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-md p-3 text-sm flex items-start gap-2 ${
            banner.kind === 'success'
              ? 'bg-[var(--success)]/10 border border-[var(--success)]/30 text-[var(--success)]'
              : banner.kind === 'error'
                ? 'bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[var(--danger)]'
                : 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)]'
          }`}
        >
          {banner.kind === 'success' ? (
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" aria-hidden />
          ) : banner.kind === 'error' ? (
            <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
          ) : null}
          <span>{banner.text}</span>
        </div>
      ) : null}

      <Card variant="secondary" className="p-5 flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('balanceLabel')}
            </span>
            <span className="text-3xl font-bold tabular-nums">
              {buckets.total.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] max-w-md">{t('balanceHint')}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <BucketChip
            label={t('subscriptionBucketLabel')}
            value={buckets.subscription}
            hint={t('subscriptionBucketHint')}
            tone="accent"
          />
          <BucketChip
            label={t('packBucketLabel')}
            value={buckets.pack}
            hint={t('packBucketHint')}
            tone="success"
          />
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('packsTitle')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-2xl">{t('packsHint')}</p>
        <div className="grid md:grid-cols-3 gap-4">
          {CREDIT_PACKS.map((pack) => {
            const configured = getStripePackPriceId(pack.id) !== null;
            return (
              <PackCard
                key={pack.id}
                packId={pack.id}
                name={t(`pack.${pack.id}.name`)}
                tagline={t(`pack.${pack.id}.tagline`)}
                credits={pack.credits}
                priceEur={pack.priceEur}
                configured={configured}
                buyLabel={t('buyButton')}
                comingSoonLabel={t('comingSoon')}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

function BucketChip({
  label,
  value,
  hint,
  tone
}: {
  label: string;
  value: number;
  hint: string;
  tone: 'accent' | 'success';
}) {
  const dot =
    tone === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--default)]">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-mono font-semibold tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-[var(--muted)] hidden sm:inline">·</span>
      <span className="text-[var(--muted)] hidden sm:inline">{hint}</span>
    </div>
  );
}

function PackCard({
  packId,
  name,
  tagline,
  credits,
  priceEur,
  configured,
  buyLabel,
  comingSoonLabel
}: {
  packId: string;
  name: string;
  tagline: string;
  credits: number;
  priceEur: number;
  configured: boolean;
  buyLabel: string;
  comingSoonLabel: string;
}) {
  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-bold tracking-tight">{name}</h3>
        <p className="text-xs text-[var(--muted)]">{tagline}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-bold tabular-nums">
          {credits.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--muted)] font-mono uppercase tracking-wider">
          credits
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold">€{priceEur.toFixed(2)}</span>
        <span className="text-xs text-[var(--muted)]">
          (€{(priceEur / credits).toFixed(4)} / credit)
        </span>
      </div>
      <form action={buyCreditPackAction} className="mt-auto">
        <input type="hidden" name="packId" value={packId} />
        <button
          type="submit"
          disabled={!configured}
          className="w-full px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          <Sparkles className="size-3.5" />
          {configured ? buyLabel : comingSoonLabel}
        </button>
      </form>
    </Card>
  );
}
