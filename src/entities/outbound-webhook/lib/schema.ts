import { z } from 'zod';
import { WEBHOOK_EVENTS } from '@/shared/db/schema';

export const MAX_WEBHOOK_URL_LENGTH = 2048;
export const MAX_DELIVERIES_PAGE = 100;
export const DEFAULT_DELIVERIES_PAGE = 20;

export const webhookEventsSchema = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1)
  .max(WEBHOOK_EVENTS.length)
  .transform((events) => Array.from(new Set(events)));

export const selfWebhookBodySchema = z.object({
  url: z.string().trim().min(1).max(MAX_WEBHOOK_URL_LENGTH),
  events: webhookEventsSchema.optional()
});
export type SelfWebhookBody = z.infer<typeof selfWebhookBodySchema>;

export const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_DELIVERIES_PAGE).default(DEFAULT_DELIVERIES_PAGE)
});
