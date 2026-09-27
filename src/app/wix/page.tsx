import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { verifyWixSessionToken, wixAppSecret } from '@/entities/shop-connection';
import { wixSessionFromInstance } from '@/features/wix-connector';
import { routing, type Locale } from '@/i18n/routing';
import { getAppContactEmail } from '@/shared/config/app-contact';
import { WIX_TOKEN_PARAM } from '@/shared/embedded';
import { EmbeddedApp } from '@/views/embedded-app';

export const dynamic = 'force-dynamic';

function first(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * The dashboard page Wix loads in the site's dashboard (iframe URL). Wix
 * appends a signed `instance`; it becomes our session token here, and every
 * read or action then goes through /api/wix/app/* with it. Coming back from
 * the full app (header link), the token itself travels in the URL.
 */
export default async function WixEmbeddedPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const fromInstance = wixSessionFromInstance(first(q.instance));
  const secret = wixAppSecret();
  const carried = first(q[WIX_TOKEN_PARAM]);
  const token =
    fromInstance?.token ??
    (carried && secret && verifyWixSessionToken(carried, secret) ? carried : null);
  // Wix passes the dashboard language as `locale` (e.g. `fr`); ours wins when set.
  const raw = String(first(q.locale) ?? '')
    .slice(0, 2)
    .toLowerCase();
  const locale: Locale = (routing.locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : routing.defaultLocale;
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={{ EmbeddedApp: messages.EmbeddedApp }}>
      <EmbeddedApp
        host="wix"
        locale={locale}
        shopHint={null}
        framed
        contactEmail={getAppContactEmail()}
        wixToken={token}
      />
    </NextIntlClientProvider>
  );
}
