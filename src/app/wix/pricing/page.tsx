import { Coins } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CREDIT_PACKS, PLAN_TIERS, wixPackPrice, wixPlanPrice } from '@/entities/ai-model';
import { wixDashboardAppUrl } from '@/features/wix-connector';
import { routing, type Locale } from '@/i18n/routing';
import { Card, Logo, Shell } from '@/views/embedded-app';

export const dynamic = 'force-dynamic';

const PAID = PLAN_TIERS.filter((t) => t.id !== 'free') as Array<
  (typeof PLAN_TIERS)[number] & { id: 'starter' | 'pro' | 'scale' }
>;

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0 })}`;
}

function first(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * The app's external pricing page for Wix (App Market listing, "Upgrade App"
 * in Manage Apps): Wix prices only, read-only — every purchase happens in the
 * app inside the Wix dashboard, through Wix checkout. No web checkout here
 * (App Market guideline: no call to action towards another purchase path).
 */
export default async function WixPricingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const raw = String(first(q.locale) ?? '')
    .slice(0, 2)
    .toLowerCase();
  const locale: Locale = (routing.locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'EmbeddedApp' });
  const instanceId = first(q.appInstanceId) ?? first(q.instanceId);
  const valid = instanceId && /^[0-9a-f-]{16,64}$/i.test(instanceId) ? instanceId : null;
  return (
    <Shell>
      <header className="flex items-center gap-3">
        <Logo />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">OneShopLab — {t('planTitle')}</h1>
          <p className="text-xs text-[var(--muted)]">{t('billedByWix')}</p>
        </div>
      </header>
      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          {PAID.map((tier) => (
            <div
              key={tier.id}
              className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-white p-4"
            >
              <span className="text-sm font-semibold">{tier.name}</span>
              <span className="text-2xl font-bold tracking-tight">
                {usd(wixPlanPrice(tier.id, 'monthly'))}
                <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                  {t('perMonth')}
                </span>
              </span>
              <span className="text-xs text-[var(--muted)]">
                {t('billedYearly', { price: usd(wixPlanPrice(tier.id, 'yearly')) })}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                <Coins className="size-3" aria-hidden />
                {t('creditsPerMonth', { credits: tier.credits })}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div>
          <h2 className="text-base font-semibold">{t('packsTitle')}</h2>
          <p className="text-xs text-[var(--muted)]">{t('packsHint')}</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {CREDIT_PACKS.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-white p-3"
            >
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="text-sm">{t('packCredits', { credits: p.credits })}</span>
              <span className="text-sm font-medium">{usd(wixPackPrice(p.id))}</span>
            </li>
          ))}
        </ul>
      </Card>
      {valid ? (
        <a
          href={wixDashboardAppUrl(valid)}
          className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
        >
          {t('openApp')}
        </a>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t('outsideWix')}</p>
      )}
    </Shell>
  );
}
