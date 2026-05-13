import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function NotFoundPage() {
  // getTranslations without an explicit locale picks up the request
  // locale set by the [locale]/layout via setRequestLocale. When this
  // page is rendered for an invalid locale path, next-intl falls back
  // to the default locale ("en") which still produces a readable
  // page.
  const t = await getTranslations('Errors');

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center text-center gap-5 max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--default)]/60 text-[var(--muted)]">
          <FileQuestion className="size-8" aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            404
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('notFoundTitle')}
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t('notFoundBody')}
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 transition-opacity"
        >
          {t('notFoundHome')}
        </Link>
      </div>
    </div>
  );
}
