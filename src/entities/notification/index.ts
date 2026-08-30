// Server entry (db-backed). The bell is a client component and lives behind
// `@/entities/notification/client` so the worker/server graph never loads it.
export {
  listForBell,
  markAllRead,
  markReadByAudit,
  markReadByJob,
  notify,
  userIdsForJobs
} from './api/notifications';
export type { NotificationInput, NotificationRow } from './api/notifications';
export {
  integrationAlertRecipient,
  integrationsUrl,
  sendIntegrationAlert
} from './api/integration-alerts';
export type {
  IntegrationAlertInput,
  IntegrationAlertKind,
  IntegrationAlertRecipient,
  IntegrationAlertResult
} from './api/integration-alerts';
export {
  INTEGRATION_EMAIL_KINDS,
  buildIntegrationEmail,
  resolveLocale
} from './lib/integration-email';
export type {
  IntegrationAlertParams,
  IntegrationEmail,
  IntegrationEmailKind,
  SyncFailureReason
} from './lib/integration-email';
