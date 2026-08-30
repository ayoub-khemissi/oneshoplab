/** Twin of shopify-connector/api/alerts.ts (features never import each other). */
import {
  integrationAlertRecipient,
  sendIntegrationAlert,
  type SyncFailureReason
} from '@/entities/notification';
import { claimConnectionAlert } from '@/entities/shop-connection';
import { WixClientError } from './client';

const SYNC_FAILED_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function alertTokenInvalid(projectId: string): Promise<void> {
  if (!(await claimConnectionAlert(projectId, 'integration_token_invalid', 0))) return;
  const to = await integrationAlertRecipient(projectId);
  if (!to) return;
  await sendIntegrationAlert({ ...to, kind: 'integration_token_invalid', params: {} });
}

export async function alertSyncFailed(
  projectId: string,
  failure: { reason: SyncFailureReason; limit?: number; error?: string }
): Promise<void> {
  const claimed = await claimConnectionAlert(
    projectId,
    'integration_sync_failed',
    SYNC_FAILED_ALERT_INTERVAL_MS
  );
  if (!claimed) return;
  const to = await integrationAlertRecipient(projectId);
  if (!to) return;
  await sendIntegrationAlert({ ...to, kind: 'integration_sync_failed', params: failure });
}

export function syncFailureReason(e: unknown): SyncFailureReason {
  if (e instanceof WixClientError && e.code === 'network') return 'unreachable';
  if (e instanceof WixClientError && e.code === 'token_invalid') return 'token_invalid';
  return 'unknown';
}

export const isWixAuthError = (e: unknown): boolean =>
  e instanceof WixClientError && e.code === 'token_invalid';
