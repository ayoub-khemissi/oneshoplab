import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter() {
  const t = await getTranslations('Footer');
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-[var(--border)] mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-[var(--muted)] flex flex-wrap items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5">
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
          OneShopLab — {t('tagline')}
        </span>
        <div className="flex items-center gap-5 flex-wrap">
          <Link
            href="/"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('home')}
          </Link>
          <Link
            href="/pricing"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            {t('pricing')}
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
        </div>
      </div>
    </footer>
  );
}
