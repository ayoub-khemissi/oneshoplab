/**
 * Copy builder for the integration alert emails (subject + text + html) in
 * the merchant's locale. Pure: `createTranslator` on the locale's message
 * file, no request context — the worker sends these outside any Next
 * request, where `getTranslations()` has no locale to read.
 *
 * Keys live under `IntegrationAlerts.*` in messages/<locale>.json; the
 * i18n checker cannot see them (no static `getTranslations('NS')`), so the
 * unit test in tests/unit/integration-email.test.ts renders every kind in
 * every locale and fails on a leftover `{placeholder}`.
 */
import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import { routing, type Locale } from '@/i18n/routing';

/** Kinds that also send an email; `integration_key_revoked` is bell-only. */
export const INTEGRATION_EMAIL_KINDS = [
  'integration_key_expiring',
  'integration_key_expired',
  'integration_token_invalid',
  'integration_sync_failed',
  'integration_webhook_disabled'
] as const;
export type IntegrationEmailKind = (typeof INTEGRATION_EMAIL_KINDS)[number];

export type SyncFailureReason = 'plan_limit' | 'unreachable' | 'token_invalid' | 'unknown';

export interface IntegrationAlertParams {
  keyName?: string;
  /** Key expiry (expiring / expired). */
  expiresAt?: Date;
  /** Whole days until expiry (expiring). */
  days?: number;
  reason?: SyncFailureReason;
  /** Plan product cap (reason plan_limit). */
  limit?: number;
  /** Raw error message (reason unknown). */
  error?: string;
  /** Webhook endpoint (webhook_disabled). */
  url?: string;
}

export interface IntegrationEmailInput {
  locale: string;
  kind: IntegrationEmailKind;
  recipientName: string | null;
  siteName: string;
  integrationsUrl: string;
  params: IntegrationAlertParams;
}

export interface IntegrationEmail {
  subject: string;
  text: string;
  html: string;
}

export function resolveLocale(locale: string | null | undefined): Locale {
  return locale && (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  return (await import(`../../../../messages/${locale}.json`)).default as AbstractIntlMessages;
}

const KEY_SUFFIX: Record<IntegrationEmailKind, string> = {
  integration_key_expiring: 'key_expiring',
  integration_key_expired: 'key_expired',
  integration_token_invalid: 'token_invalid',
  integration_sync_failed: 'sync_failed',
  integration_webhook_disabled: 'webhook_disabled'
};

export async function buildIntegrationEmail(
  input: IntegrationEmailInput
): Promise<IntegrationEmail> {
  const locale = resolveLocale(input.locale);
  const messages = await loadMessages(locale);
  // Keys are built at runtime (kind, reason), so the strict key typing of
  // next-intl (no global AppConfig here) is dropped; the unit test covers them.
  const tr = createTranslator({ locale, messages }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
  const t = (key: string, v?: Record<string, string | number>) => tr(`IntegrationAlerts.${key}`, v);
  const p = input.params;
  const values = {
    name: input.recipientName ?? '',
    siteName: input.siteName,
    keyName: p.keyName ?? '',
    days: p.days ?? 0,
    date: p.expiresAt
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(p.expiresAt)
      : '',
    limit: p.limit ?? 0,
    error: p.error ?? '',
    url: p.url ?? ''
  };
  const ns = KEY_SUFFIX[input.kind];
  const lines: string[] = [t(`${ns}.body`, values)];
  if (input.kind === 'integration_token_invalid') {
    lines.push(t(`${ns}.step1`), t(`${ns}.step2`), t(`${ns}.step3`));
  } else if (input.kind === 'integration_sync_failed') {
    lines.push(t(`${ns}.reason_${p.reason ?? 'unknown'}`, values));
  } else {
    lines.push(t(`${ns}.action`));
  }
  const greeting = input.recipientName ? t('greeting', values) : t('greetingAnon');
  const open = t('open');
  const footer = t('footer', values);
  const signature = t('signature');

  const text = [
    greeting,
    '',
    ...lines,
    '',
    `${open}: ${input.integrationsUrl}`,
    '',
    footer,
    signature
  ].join('\n');
  const html = [
    `<p>${esc(greeting)}</p>`,
    ...lines.map((l) => `<p>${esc(l)}</p>`),
    `<p><a href="${esc(input.integrationsUrl)}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${esc(open)}</a></p>`,
    `<p style="color:#888;font-size:12px">${esc(footer)}<br>${esc(signature)}</p>`
  ].join('\n');
  return { subject: t(`${ns}.subject`, values), text, html };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
