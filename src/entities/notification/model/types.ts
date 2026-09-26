import type { NotificationKind } from '@/shared/db/schema';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  jobId: string | null;
  auditId: string | null;
  productId: string | null;
  projectId: string | null;
  payload: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
}
