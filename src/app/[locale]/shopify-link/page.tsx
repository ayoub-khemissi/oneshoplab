import { CheckCircle2, Link2 } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { auth } from '@/entities/user';
import { getShopifyShop } from '@/entities/shop-connection';
import { embeddedAppUrl, linkShopToUser, verifyShopLinkToken } from '@/features/shopify-connector';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

export const dynamic = 'force-dynamic';

function linkPath(locale: string, token: string): string {
  return `/${locale}/shopify-link?t=${encodeURIComponent(token)}`;
}

// Module-level action fed by the form: an inline action closing over the
// page's destructured `t` lost the binding in production (ReferenceError).
async function confirmShopLink(formData: FormData): Promise<void> {
  'use server';
  const token = String(formData.get('t') ?? '');
  const rawLocale = String(formData.get('locale') ?? '');
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale : 'en';
  const self = linkPath(locale, token);
  const s = await auth();
  if (!s?.user?.id) redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);
  const res = await linkShopToUser(token, s.user.id);
  redirect(`${self}&${res.ok ? 'done=1' : `error=${res.reason}`}`);
}

/**
 * A merchant who already has a OneShopLab account installed the app from
 * Shopify: the embedded app sent them here (new tab, first-party cookies) to
 * attach the shop to that account. Logging in is the proof of ownership.
 */
export default async function ShopifyLinkPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const token = query.t ?? '';
  const { done, error } = query;
  const t = await getTranslations('ShopifyLink');
  const session = await auth();
  const self = linkPath(locale, token);
  if (!session?.user?.id) redirect(`/${locale}/login?next=${encodeURIComponent(self)}`);

  const shop = verifyShopLinkToken(token);
  const row = shop ? await getShopifyShop(shop) : null;

  const box =
    'mx-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm';
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      {!shop || !row ? (
        <section className={box}>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-[var(--muted)]">{t('invalid')}</p>
        </section>
      ) : done ? (
        <section className={box}>
          <CheckCircle2 className="size-8 text-[var(--success)]" aria-hidden />
          <h1 className="text-xl font-semibold">{t('success', { shop: row.shopName ?? shop })}</h1>
          <a
            href={embeddedAppUrl(shop)}
            className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
          >
            {t('backToShopify')}
          </a>
        </section>
      ) : (
        <section className={box}>
          <Link2 className="size-8 text-[var(--accent)]" aria-hidden />
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-[var(--muted)]">
            {t('body', { shop: row.shopName ?? shop, email: session.user.email ?? '' })}
          </p>
          {error ? (
            <p className="text-sm text-[var(--danger)]">
              {error === 'linked_elsewhere'
                ? t('linkedElsewhere')
                : error === 'not_installed'
                  ? t('notInstalled')
                  : t('invalid')}
            </p>
          ) : null}
          <form action={confirmShopLink}>
            <input type="hidden" name="t" value={token} />
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)]"
            >
              {t('confirm')}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
