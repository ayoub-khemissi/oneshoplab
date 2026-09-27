import { Coins, CreditCard, LayoutGrid } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { bellLabels, NotificationBell } from '@/entities/notification/client';
import { auth } from '@/entities/user';
import type { Locale } from '@/i18n/routing';
import { EmbeddedHomeLink } from '@/shared/embedded/client';
import { ScrollHidingHeader } from '@/shared/ui';

/**
 * The header inside a store admin (Shopify, Wix). The admin already frames
 * the page, so no site navigation, no sign-in or sign-out (the store is the
 * session), and plans and packs live on the embedded home, billed by the
 * store.
 */
export async function EmbeddedHeader() {
  const t = await getTranslations('Nav');
  const session = await auth();
  const user = session?.user;
  const locale = (await getLocale()) as Locale;
  const item =
    'inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors';

  // Same sticky shell as the site header: the pages' sticky sub-headers are
  // positioned under it (--site-header-h).
  return (
    <ScrollHidingHeader>
      <header className="w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-3">
          <nav className="flex items-center gap-4 text-sm min-w-0">
            <Link
              href={
                session?.embedded?.projectId
                  ? `/dashboard/sites/${session.embedded.projectId}`
                  : '/dashboard'
              }
              className={item}
            >
              <LayoutGrid className="size-4" aria-hidden />
              {t('dashboard')}
            </Link>
            <EmbeddedHomeLink
              host={session?.embedded?.host ?? 'shopify'}
              locale={locale}
              className={item}
            >
              <CreditCard className="size-4" aria-hidden />
              {t('subscription')}
            </EmbeddedHomeLink>
          </nav>
          {user ? (
            <div className="flex items-center gap-2">
              <NotificationBell ariaLabel={t('notifications.title')} labels={bellLabels(t)} />
              <Link
                href="/account/credits"
                title={t('credits')}
                aria-label={`${user.creditsBalance ?? 0} ${t('credits')}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono font-semibold hover:bg-[var(--accent)]/20 transition-colors"
              >
                <Coins className="size-3.5" aria-hidden />
                {(user.creditsBalance ?? 0).toLocaleString(locale)}
              </Link>
            </div>
          ) : null}
        </div>
      </header>
    </ScrollHidingHeader>
  );
}
