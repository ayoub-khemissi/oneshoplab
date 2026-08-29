import type Stripe from 'stripe';
import { getLocale, getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

export { LEGAL_TERMS_VERSION } from './legal-version';

const APP_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

/** Stripe Checkout accepts our two-letter codes as-is (ar, de, en, es,
 *  fr, it, ja, ko, pl, pt, ru, tr, zh are all valid Checkout locales). */
/** Derived from the SDK method signature so it survives Stripe's type
 *  namespace reshuffles between major versions. */
type SessionCreateParams = NonNullable<Parameters<Stripe['checkout']['sessions']['create']>[0]>;
export type CheckoutConsentParams = Pick<
  SessionCreateParams,
  'locale' | 'consent_collection' | 'custom_text'
>;

/**
 * Everything Stripe Checkout needs to collect an explicit, binding
 * acceptance: a mandatory checkbox (consent_collection) plus our own
 * sentence with links to the Terms and the Privacy Policy and the EU
 * consumer right-of-withdrawal waiver. Stripe renders markdown links in
 * custom_text; the message is capped at 1200 characters.
 */
export async function checkoutConsentParams(): Promise<CheckoutConsentParams> {
  const raw = await getLocale();
  const locale = ((SUPPORTED_LOCALES as readonly string[]).includes(raw)
    ? raw
    : 'en') as (typeof SUPPORTED_LOCALES)[number];
  const t = await getTranslations({ locale, namespace: 'Checkout' });
  const terms = `[${t('termsLabel')}](${APP_URL}/${locale}/terms)`;
  const privacy = `[${t('privacyLabel')}](${APP_URL}/${locale}/privacy)`;
  const message = t('consent', { terms, privacy }).slice(0, 1200);
  return {
    locale: locale as SessionCreateParams['locale'],
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message } }
  };
}
