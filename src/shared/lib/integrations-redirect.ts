import { SUPPORTED_LOCALES } from '@/i18n/routing';

/** Where every store-connector OAuth flow lands: the project's Integrations tab. */
export function integrationsTabPath(
  locale: string,
  projectId: string,
  query: Record<string, string>
): string {
  const safeLocale = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : 'en';
  const qs = new URLSearchParams({ tab: 'integrations', ...query }).toString();
  return `/${safeLocale}/dashboard/sites/${projectId}?${qs}`;
}

export function safeLocale(input: string | null | undefined): string {
  return input && (SUPPORTED_LOCALES as readonly string[]).includes(input) ? input : 'en';
}
