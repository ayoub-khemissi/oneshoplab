/**
 * Integration alerts = one bell notification + (for most kinds) one email in
 * the merchant's locale. Takes plain inputs: idempotency is the caller's
 * (api-key events table for keys, `shop_connections.last_alert_*` for
 * connections) so this module stays free of other entities.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { legalConsents, projects, users, type NotificationKind } from '@/shared/db/schema';
import { db } from '@/shared/db';
import { sendMail } from '@/shared/mailer';
import {
  INTEGRATION_EMAIL_KINDS,
  buildIntegrationEmail,
  resolveLocale,
  type IntegrationAlertParams,
  type IntegrationEmailKind
} from '../lib/integration-email';
import { notify } from './notifications';

export type IntegrationAlertKind = Extract<NotificationKind, `integration_${string}`>;

export interface IntegrationAlertRecipient {
  userId: string;
  email: string;
  name: string | null;
  /** Last locale the user signed something in (signup / checkout); null → en. */
  locale: string | null;
  projectId: string;
  siteName: string;
}

export interface IntegrationAlertInput extends IntegrationAlertRecipient {
  kind: IntegrationAlertKind;
  params: IntegrationAlertParams;
}

export interface IntegrationAlertResult {
  notificationId: string;
  emailed: boolean;
}

/** Owner + locale + site name for a project — null when the project is gone. */
export async function integrationAlertRecipient(
  projectId: string
): Promise<IntegrationAlertRecipient | null> {
  const [row] = await db
    .select({ userId: users.id, email: users.email, name: users.name, siteName: projects.name })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.id, projectId));
  if (!row) return null;
  const [consent] = await db
    .select({ locale: legalConsents.locale })
    .from(legalConsents)
    .where(and(eq(legalConsents.userId, row.userId), isNotNull(legalConsents.locale)))
    .orderBy(desc(legalConsents.acceptedAt))
    .limit(1);
  return { ...row, locale: consent?.locale ?? null, projectId };
}

function isEmailKind(kind: IntegrationAlertKind): kind is IntegrationEmailKind {
  return (INTEGRATION_EMAIL_KINDS as readonly string[]).includes(kind);
}

export function integrationsUrl(projectId: string, locale: string): string {
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3030').replace(/\/$/, '');
  return `${appUrl}/${resolveLocale(locale)}/dashboard/sites/${projectId}?tab=integrations`;
}

export async function sendIntegrationAlert(
  input: IntegrationAlertInput
): Promise<IntegrationAlertResult> {
  const locale = resolveLocale(input.locale);
  const { expiresAt, ...payloadParams } = input.params;
  const notificationId = await notify({
    userId: input.userId,
    kind: input.kind,
    projectId: input.projectId,
    payload: {
      ...payloadParams,
      siteName: input.siteName,
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {})
    }
  });
  if (!isEmailKind(input.kind)) return { notificationId, emailed: false };

  const mail = await buildIntegrationEmail({
    locale,
    kind: input.kind,
    recipientName: input.name,
    siteName: input.siteName,
    integrationsUrl: integrationsUrl(input.projectId, locale),
    params: input.params
  });
  // Best effort: an SMTP outage must not fail the sweep / pull that raised
  // the alert; the bell row already exists.
  const res = await sendMail({ to: input.email, ...mail }).catch((e: unknown) => {
    console.error('[integration-alerts] sendMail threw', e);
    return { ok: false as const };
  });
  return { notificationId, emailed: res.ok };
}
