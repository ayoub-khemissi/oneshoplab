import { createTranslator } from 'next-intl';
import type { PushPayload } from '@/entities/push-subscription';
import type { Locale } from '@/i18n/routing';
import type { NotificationKind } from '@/shared/db/schema';
import { loadMessages, resolveLocale } from './integration-email';
import { notificationHref } from './href';

/**
 * What a notice says on a lock screen, and where a tap on it lands.
 *
 * A push is the bell reaching the merchant outside the app: same words
 * (`Nav.notifications.kinds.*`), same destination (`notificationHref`), same
 * language as the rest of their account. Both read from here, so a change to
 * one is a change to both.
 */
export interface PushNotice {
  kind: NotificationKind;
  projectId?: string | null;
  productId?: string | null;
  auditId?: string | null;
  payload?: Record<string, unknown> | null;
}

const SUB_MAX_LEN = 90;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The second line: the same detail the bell puts under the title. */
export function pushBodyFor(notice: PushNotice, fieldLabel: (field: string) => string): string {
  const payload = notice.payload ?? {};
  const str = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : null);
  const num = (key: string) => (typeof payload[key] === 'number' ? (payload[key] as number) : null);

  if (notice.kind === 'chat_completed' || notice.kind === 'chat_failed') {
    const field = str('field');
    const preview = str('preview');
    const label = field ? fieldLabel(field) : null;
    if (label && preview) return truncate(`${label} : ${preview}`, SUB_MAX_LEN);
    return truncate(label ?? preview ?? '', SUB_MAX_LEN);
  }
  if (notice.kind === 'image_completed' || notice.kind === 'image_failed') {
    return truncate(str('productTitle') ?? '', SUB_MAX_LEN);
  }
  if (notice.kind === 'audit_completed' || notice.kind === 'audit_failed') {
    const domain = str('domain');
    const score = num('score');
    if (domain && score != null && notice.kind === 'audit_completed') {
      return truncate(`${domain} · ${score}/100`, SUB_MAX_LEN);
    }
    return truncate(domain ?? '', SUB_MAX_LEN);
  }
  if (notice.kind === 'bulk_completed' || notice.kind === 'bulk_failed') {
    const generated = num('generated');
    const total = num('total');
    return generated != null && total != null ? `${generated}/${total}` : '';
  }
  if (notice.kind.startsWith('integration_')) {
    const keyName = str('keyName');
    const siteName = str('siteName');
    const label = keyName && siteName ? `${keyName} · ${siteName}` : (keyName ?? siteName);
    return truncate(label ?? '', SUB_MAX_LEN);
  }
  return '';
}

/** The whole payload, in the account's language. */
export async function pushPayloadFor(
  notice: PushNotice,
  locale: string | null | undefined,
  appUrl: string,
  /** The product's own photo, when the notice is about one. */
  icon?: string | null
): Promise<PushPayload> {
  const resolved: Locale = resolveLocale(locale);
  const messages = await loadMessages(resolved);
  const t = createTranslator({ locale: resolved, messages, namespace: 'Nav' });

  const title = t(`notifications.kinds.${notice.kind}` as never) as string;
  const body = pushBodyFor(notice, (field) =>
    field === 'title' || field === 'description' || field === 'tags'
      ? (t(`notifications.fieldLabels.${field}` as never) as string)
      : field
  );
  // The payload carries the field the notice is about, which is what turns
  // "your product page" into "this title".
  const path = notificationHref({
    kind: notice.kind,
    projectId: notice.projectId ?? null,
    productId: notice.productId ?? null,
    auditId: notice.auditId ?? null,
    payload: notice.payload ?? null
  });

  return {
    title,
    body,
    url: path ? `${appUrl}/${resolved}${path}` : `${appUrl}/${resolved}/dashboard`,
    // The event, not the row: two devices of the same person are each told,
    // and a second push about the same thing replaces the first.
    tag: `${notice.kind}:${notice.productId ?? notice.projectId ?? notice.auditId ?? 'general'}`,
    ...(icon ? { icon } : {})
  };
}
