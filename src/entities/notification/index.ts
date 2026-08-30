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
