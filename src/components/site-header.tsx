import { Coins } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { auth } from '@/lib/auth';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import type { Locale } from '@/i18n/routing';

/**
 * Site-wide header. Server component — fetches the auth session once per
 * request and either renders sign-in / sign-up CTAs or the UserMenu (Avatar
 * dropdown) for the logged-in user.
 */
export async function SiteHeader() {
  const t = await getTranslations('Nav');
  const session = await auth();
  const user = session?.user;
  const locale = (await getLocale()) as Locale;

  return (
    <header className="w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="size-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_20px_var(--accent)]" />
            OneShopLab
            <span className="ml-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">
              Beta
            </span>
          </Link>
          <Link
            href="/pricing"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            {t('pricing')}
          </Link>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <LocaleSwitcher current={locale} ariaLabel={t('changeLanguage')} />
          <ThemeToggle ariaLabel={t('changeTheme')} />
          <span className="w-px h-6 bg-[var(--border)] mx-1.5" aria-hidden />
          {user ? (
            <>
              <Link
                href="/account/credits"
                title={t('credits')}
                aria-label={`${user.creditsBalance ?? 0} ${t('credits')}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono font-semibold hover:bg-[var(--accent)]/20 transition-colors mr-1"
              >
                <Coins className="size-3.5" aria-hidden />
                {(user.creditsBalance ?? 0).toLocaleString(locale)}
              </Link>
              <UserMenu
                name={user.name ?? null}
                email={user.email ?? null}
                image={user.image ?? null}
                creditsBalance={user.creditsBalance ?? 0}
                plan={user.plan ?? 'free'}
                creditsLabel={t('credits')}
                planLabel={t('plan')}
                dashboardLabel={t('dashboard')}
                preferencesLabel={t('preferences')}
                buyCreditsLabel={t('buyCredits')}
                manageSubscriptionLabel={t('manageSubscription')}
                upgradeLabel={t('upgrade')}
                signOutLabel={t('signOut')}
                signedInAsLabel={t('signedInAs')}
              />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-md hover:bg-[var(--default)] transition-colors"
              >
                {t('signIn')}
              </Link>
              <Link
                href="/signup"
                className="px-4 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 font-medium transition-opacity"
              >
                {t('signUp')}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
