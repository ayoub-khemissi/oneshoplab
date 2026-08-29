import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContactForm } from '@/components/contact-form';
import { Link } from '@/i18n/navigation';
import { SUPPORTED_LOCALES } from '@/i18n/routing';
import { auth } from '@/lib/auth';
import { isRecaptchaEnabled } from '@/lib/recaptcha';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Contact' });
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/contact`;
  }
  languages['x-default'] = `${SITE_URL}/en/contact`;
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: `${SITE_URL}/${locale}/contact`, languages },
    robots: { index: true, follow: true }
  };
}

export default async function ContactPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, session] = await Promise.all([getTranslations('Contact'), auth()]);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const recaptchaSiteKey = isRecaptchaEnabled() && siteKey ? siteKey : null;
  const discordUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? null;

  return (
    <main className="flex-1 px-4 md:px-10 py-8 md:py-14 max-w-2xl w-full mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">{t('eyebrow')}</span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">{t('lead')}</p>
      </header>

      <ContactForm
        locale={locale}
        recaptchaSiteKey={recaptchaSiteKey}
        defaults={{
          name: session?.user?.name ?? '',
          email: session?.user?.email ?? ''
        }}
      />

      {discordUrl ? (
        <p className="text-sm text-[var(--muted)]">
          {t('altDiscord')}{' '}
          <a
            href={discordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline underline-offset-2"
          >
            {t('altDiscordLink')}
          </a>
        </p>
      ) : null}
      <p className="text-xs text-[var(--muted)]">
        <Link href="/privacy" className="hover:underline underline-offset-2">
          {t('privacyLink')}
        </Link>
      </p>
    </main>
  );
}
