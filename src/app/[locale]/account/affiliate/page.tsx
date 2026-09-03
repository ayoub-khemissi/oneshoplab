import { Card } from '@heroui/react';
import { ArrowUpRight, BadgeEuro, Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { auth } from '@/entities/user';

/**
 * The affiliate programme, from inside an account.
 *
 * A partner's own numbers live on the affiliate platform, not here — so this
 * page does the two things it can do honestly: explain the deal in three lines,
 * and hand over the right door. Which door depends on whether the programme is
 * live yet: the partner dashboard when its address is configured, our inbox
 * until then.
 */
export default async function AccountAffiliatePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const t = await getTranslations('Affiliate');
  const tAccount = await getTranslations('Account');
  const dashboardUrl = process.env.FIRSTPROMOTER_DASHBOARD_URL ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{tAccount('tabAffiliate')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{t('subtitle')}</p>
      </header>

      <Card variant="secondary" className="flex flex-col gap-3 p-5">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <BadgeEuro className="size-4 text-[var(--accent)]" aria-hidden />
          {t('rateTitle')}
        </span>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('rateBody')}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {dashboardUrl ? (
            <a
              href={dashboardUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              {t('dashboardCta')}
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
          ) : (
            <Link
              href="/contact?subject=affiliate"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
            >
              <Mail className="size-4" aria-hidden />
              {t('cta')}
            </Link>
          )}
          <Link
            href="/affiliate"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t('rulesLink')}
          </Link>
        </div>
      </Card>

      <Card variant="secondary" className="flex flex-col gap-2 p-5">
        <span className="text-sm font-semibold">{t('step_share_title')}</span>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('step_share_body')}</p>
        <span className="pt-2 text-sm font-semibold">{t('step_earn_title')}</span>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{t('step_earn_body')}</p>
      </Card>
    </div>
  );
}
