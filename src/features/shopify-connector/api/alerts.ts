/**
 * Merchant alerts raised by the connector (bell + email, see
 * entities/notification). Idempotency lives on the connection row:
 * `token_invalid` once per invalidation (the `connected → token_invalid`
 * flip), `sync_failed` at most once per 24 h.
 */
import {
  integrationAlertRecipient,
  sendIntegrationAlert,
  type SyncFailureReason
} from '@/entities/notification';
import { claimConnectionAlert } from '@/entities/shop-connection';
import { ShopifyAdminError } from './admin-client';

export const SYNC_FAILED_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  if (e instanceof ShopifyAdminError && e.code === 'network') return 'unreachable';
  if (e instanceof ShopifyAdminError && e.code === 'token_invalid') return 'token_invalid';
  return 'unknown';
}
