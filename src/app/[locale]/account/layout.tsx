import type { Metadata } from 'next';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AccountTabs } from '@/features/account';
import { ScrollAwareSticky } from '@/shared/ui';

// Authenticated account area: noindex everywhere under /account.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

/**
 * Account section shell. The back-to-dashboard link + tabs are wrapped
 * in <ScrollAwareSticky> using the same configuration as the per-site
 * dashboard (<dashboard/sites/[siteId]>) sub-header so behaviour is
 * identical: the bar shrinks (compact mode) on scroll and tucks
 * directly under the visible main header — sliding up to top:0 on
 * mobile when the main header hides on scroll-down (the
 * --site-header-h CSS var does that automatically).
 *
 * The wrapping container uses the same `p-4 md:p-10` rhythm as the
 * per-site main, so the sticky bar's negative gutters
 * (`-mx-4 md:-mx-10`) line up with the parent's padding edge.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('Account');
  // The <main> wraps both the sticky sub-header AND the page content
  // so position:sticky has a tall parent to stick within — without
  // this the bar would lose its sticky position once the layout's
  // bounded container ended (i.e. immediately).
  //
  // p-4 md:p-10 matches the rhythm of /dashboard/sites/[siteId]/page
  // so ScrollAwareSticky's `-mx-4 md:-mx-10 px-4 md:px-10` negative
  // gutters land flush with the parent's padding edge.
  return (
    <main className="flex-1 p-4 md:p-10 max-w-4xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <ScrollAwareSticky topOffsetPx={68}>
        {/* Compact-mode driven by data-compact on the sticky group:
            shrinks the back link to text-xs and tightens the icon
            once the user has scrolled past the threshold, mirroring
            the per-site dashboard sticky bar behaviour. */}
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] inline-flex items-center gap-1.5 w-fit transition-[font-size,gap] duration-200 group-data-[compact=true]/sticky:text-xs group-data-[compact=true]/sticky:gap-1"
        >
          <ChevronLeft
            className="size-4 transition-[width,height] duration-200 group-data-[compact=true]/sticky:size-3.5"
            aria-hidden
          />
          {t('backToDashboard')}
        </Link>
        <AccountTabs
          labels={{
            profile: t('tabProfile'),
            subscription: t('tabSubscription'),
            affiliate: t('tabAffiliate'),
            preferences: t('tabPreferences'),
            credits: t('tabCredits')
          }}
        />
      </ScrollAwareSticky>
      {children}
    </main>
  );
}
