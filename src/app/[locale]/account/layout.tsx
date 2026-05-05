import type { Metadata } from 'next';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AccountTabs } from '@/components/account-tabs';

// Authenticated account area: noindex everywhere under /account.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('Account');
  return (
    <div className="flex-1 flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-6 md:px-10 pt-10 pb-4 flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] inline-flex items-center gap-1.5 w-fit transition-colors"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('backToDashboard')}
        </Link>
        <AccountTabs
          labels={{
            profile: t('tabProfile'),
            subscription: t('tabSubscription'),
            preferences: t('tabPreferences'),
            credits: t('tabCredits')
          }}
        />
      </div>
      {children}
    </div>
  );
}
