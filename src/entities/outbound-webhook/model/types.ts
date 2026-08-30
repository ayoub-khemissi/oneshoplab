import type { outboundWebhooks, webhookDeliveries, WebhookEvent } from '@/shared/db/schema';

export type OutboundWebhookRow = typeof outboundWebhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

/** Secret-free shape for the UI and the API — the ciphertext never leaves the entity. */
export type OutboundWebhookView = Omit<
  OutboundWebhookRow,
  'secretCiphertext' | 'keyId' | 'urlHash'
>;

export interface WebhookDeliveryView {
  id: string;
  webhookId: string;
  eventId: string;
  event: string;
  attempt: number;
  status: WebhookDeliveryRow['status'];
  responseStatus: number | null;
  responseBody: string | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface UpsertWebhookInput {
  url: string;
  events?: WebhookEvent[];
  createdBy?: string | null;
}

export type WebhookUrlRejection =
  'invalid_url' | 'not_https' | 'blocked_host' | 'private_address' | 'dns_failed';

export type UpsertWebhookResult =
  | { ok: true; id: string; secret: string; rotated: boolean }
  | { ok: false; reason: WebhookUrlRejection | 'sealing_unavailable' };

export type OwnedWebhookResult<T> = { ok: true; value: T } | { ok: false; reason: 'not_found' };

/** `ping` is the test event; it is never part of a subscription. */
export type DeliveryEvent = WebhookEvent | 'ping';

export interface EmitResult {
  eventId: string;
  deliveryIds: string[];
}

export type DeliveryOutcome =
  { kind: 'response'; status: number; body: string } | { kind: 'error'; message: string };

export interface RecordOutcomeResult {
  deliveryStatus: WebhookDeliveryRow['status'];
  nextAttemptAt: Date | null;
  /** True only for the call that flipped the webhook to disabled. */
  disabledNow: boolean;
}
