import { Coins } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { auth } from '@/lib/auth';
import { DiscordGlyph } from './discord-glyph';
import { LocaleSwitcher } from './locale-switcher';
import { MobileMenu } from './mobile-menu';
import { NotificationBell } from './notification-bell';
import { ScrollHidingHeader } from './scroll-hiding-header';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import type { NotificationKind } from '@/lib/db/schema';
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

  const creditsDisplay = (user?.creditsBalance ?? 0).toLocaleString(locale);

  // Bell labels are passed in by the server so the i18n boundary
  // stays out of the client component. Resolving the per-kind labels
  // upfront also lets the bell be a pure dumb renderer.
  const notifKinds: Record<NotificationKind, string> = {
    chat_completed: t('notifications.kinds.chat_completed'),
    chat_failed: t('notifications.kinds.chat_failed'),
    image_completed: t('notifications.kinds.image_completed'),
    image_failed: t('notifications.kinds.image_failed'),
    audit_completed: t('notifications.kinds.audit_completed'),
    audit_failed: t('notifications.kinds.audit_failed'),
    bulk_completed: t('notifications.kinds.bulk_completed'),
    bulk_failed: t('notifications.kinds.bulk_failed')
  };
  const notifLabels = {
    panelTitle: t('notifications.title'),
    emptyState: t('notifications.empty'),
    markAllRead: t('notifications.markAllRead'),
    kinds: notifKinds,
    fieldLabels: {
      title: t('notifications.fieldLabels.title'),
      description: t('notifications.fieldLabels.description'),
      tags: t('notifications.fieldLabels.tags')
    },
    relativeNow: t('notifications.relativeNow'),
    relativeMinutes: t('notifications.relativeMinutes'),
    relativeHours: t('notifications.relativeHours'),
    relativeDays: t('notifications.relativeDays')
  };

  return (
    <ScrollHidingHeader>
      <header className="w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 md:gap-4">
          <div className="flex items-center gap-4 md:gap-4 min-w-0">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight shrink-0">
              {/* Two SVGs swapped via the dark: class — light variant on the
                dark theme (light fill on dark bg) and vice versa. eslint-disable
                because the project standard is plain <img>, not next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/osl-dark.svg"
                alt=""
                aria-hidden
                className="block dark:hidden h-7 w-auto"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/osl-light.svg"
                alt=""
                aria-hidden
                className="hidden dark:block h-7 w-auto"
              />
              OneShopLab
              <span className="ml-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-semibold">
                Beta
              </span>
            </Link>
            <Link
              href="/pricing"
              className="hidden md:inline text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('pricing')}
            </Link>
            <Link
              href="/faq"
              className="hidden md:inline text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('faq')}
            </Link>
            <Link
              href="/blog"
              className="hidden md:inline text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('blog')}
            </Link>
            <Link
              href="/contact"
              className="hidden md:inline text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('contact')}
            </Link>
            {user ? (
              <Link
                href="/dashboard"
                className="hidden md:inline text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                {t('dashboard')}
              </Link>
            ) : null}
          </div>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ? (
              <a
                href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL}
                target="_blank"
                rel="noreferrer noopener"
                title={t('joinDiscord')}
                aria-label={t('joinDiscord')}
                className="inline-flex items-center justify-center size-9 rounded-md hover:bg-[var(--default)] text-[var(--muted)] hover:text-[#5865F2] transition-colors"
              >
                <DiscordGlyph className="size-4" />
              </a>
            ) : null}
            {user ? (
              <NotificationBell ariaLabel={t('notifications.title')} labels={notifLabels} />
            ) : null}
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
                  profileLabel={t('profile')}
                  subscriptionLabel={t('subscription')}
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

          {/* Mobile-only: credits chip (when signed in) + bell + burger drawer.
            Hidden on md+ where the full nav above takes over. */}
          <div className="md:hidden flex items-center gap-2">
            {user ? (
              <Link
                href="/account/credits"
                title={t('credits')}
                aria-label={`${creditsDisplay} ${t('credits')}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono font-semibold hover:bg-[var(--accent)]/20 transition-colors"
              >
                <Coins className="size-3.5" aria-hidden />
                {creditsDisplay}
              </Link>
            ) : null}
            {user ? (
              <NotificationBell ariaLabel={t('notifications.title')} labels={notifLabels} />
            ) : null}
            <MobileMenu
              user={
                user
                  ? {
                      name: user.name ?? null,
                      email: user.email ?? null,
                      plan: user.plan ?? 'free',
                      creditsBalance: user.creditsBalance ?? 0
                    }
                  : null
              }
              creditsDisplay={creditsDisplay}
              labels={{
                signIn: t('signIn'),
                signUp: t('signUp'),
                pricing: t('pricing'),
                faq: t('faq'),
                blog: t('blog'),
                contact: t('contact'),
                dashboard: t('dashboard'),
                credits: t('credits'),
                signedInAs: t('signedInAs'),
                profile: t('profile'),
                subscription: t('subscription'),
                preferences: t('preferences'),
                buyCredits: t('buyCredits'),
                signOut: t('signOut'),
                appearance: t('changeTheme'),
                language: t('changeLanguage'),
                closeMenu: t('closeMenu'),
                openMenu: t('openMenu'),
                menuTitle: t('menuTitle'),
                joinDiscord: t('joinDiscord')
              }}
              discordUrl={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? null}
              localeSwitcher={<LocaleSwitcher current={locale} ariaLabel={t('changeLanguage')} />}
              themeToggle={<ThemeToggle ariaLabel={t('changeTheme')} />}
            />
          </div>
        </div>
      </header>
    </ScrollHidingHeader>
  );
}
