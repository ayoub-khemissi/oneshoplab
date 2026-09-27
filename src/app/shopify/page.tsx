import { NextIntlClientProvider } from 'next-intl';
import { headers } from 'next/headers';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { EmbeddedApp } from '@/views/embedded-app';
import { routing, type Locale } from '@/i18n/routing';
import { getAppContactEmail } from '@/shared/config/app-contact';

export const dynamic = 'force-dynamic';

/**
 * The page Shopify loads in the admin (App URL). It renders a client shell:
 * App Bridge supplies the ID token, and every read or action goes through
 * /api/shopify/app/* with it — nothing here trusts the query string.
 */
export default async function ShopifyEmbeddedPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const raw = String(Array.isArray(q.locale) ? q.locale[0] : (q.locale ?? ''))
    .slice(0, 2)
    .toLowerCase();
  const locale: Locale = (routing.locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : routing.defaultLocale;
  setRequestLocale(locale);
  const messages = await getMessages();
  const shop = typeof q.shop === 'string' ? q.shop : null;
  // Reached from the embedded header, the URL names no shop: the frame does.
  const framed = (await headers()).get('sec-fetch-dest') === 'iframe';
  return (
    <NextIntlClientProvider locale={locale} messages={{ EmbeddedApp: messages.EmbeddedApp }}>
      <EmbeddedApp
        host="shopify"
        locale={locale}
        shopHint={shop}
        framed={framed}
        contactEmail={getAppContactEmail()}
      />
    </NextIntlClientProvider>
  );
}
