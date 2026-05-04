import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter() {
  const t = await getTranslations('Footer');
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-[var(--border)] mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-[var(--muted)] flex flex-wrap items-center justify-between gap-4">
        <span>© {year} OneShopLab — {t('tagline')}</span>
        <div className="flex items-center gap-5">
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
        </div>
      </div>
    </footer>
  );
}
