import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter() {
  const t = await getTranslations('Footer');
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-[var(--border)] mt-auto">
      {/* Mobile: vertical stack centred, nav-row first then copyright.
          md+: original side-by-side row with copyright left, nav right. */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 md:py-6 text-xs text-[var(--muted)] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 justify-center md:justify-start text-center md:text-left">
          © {year}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/osl-dark.svg"
            alt=""
            aria-hidden
            className="block dark:hidden h-4 w-auto"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/osl-light.svg"
            alt=""
            aria-hidden
            className="hidden dark:block h-4 w-auto"
          />
          <span className="truncate">OneShopLab — {t('tagline')}</span>
        </span>
        <nav className="flex items-center justify-center md:justify-end flex-wrap gap-x-4 gap-y-2 md:gap-x-5">
          <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
            {t('home')}
          </Link>
          <Link
            href="/pricing"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('pricing')}
          </Link>
          <Link
            href="/faq"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('faq')}
          </Link>
          <Link
            href="/dashboard"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('dashboard')}
          </Link>
          <Link
            href="/terms"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('terms')}
          </Link>
          <Link
            href="/privacy"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('privacy')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
