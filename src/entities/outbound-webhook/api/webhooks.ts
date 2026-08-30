import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/shared/db';
import { outboundWebhooks, webhookDeliveries, WEBHOOK_EVENTS } from '@/shared/db/schema';
import { hasSecretBoxKey, openSecret, sealSecret } from '@/shared/lib';
import { MAX_DELIVERIES_PAGE } from '../lib/schema';
import { generateWebhookSecret } from '../lib/signing';
import { checkWebhookUrl, type LookupFn } from '../lib/ssrf';
import type {
  OutboundWebhookRow,
  OutboundWebhookView,
  OwnedWebhookResult,
  UpsertWebhookInput,
  UpsertWebhookResult,
  WebhookDeliveryRow,
  WebhookDeliveryView
} from '../model/types';

export function hashWebhookUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export function toWebhookView(row: OutboundWebhookRow): OutboundWebhookView {
  const { secretCiphertext: _s, keyId: _k, urlHash: _h, ...view } = row;
  return view;
}

export function toDeliveryView(row: WebhookDeliveryRow): WebhookDeliveryView {
  const { payload: _p, ...view } = row;
  return view;
}

/** Plaintext for signing — only the delivery loop calls this. */
export function openWebhookSecret(row: Pick<OutboundWebhookRow, 'secretCiphertext'>): string {
  return openSecret(row.secretCiphertext);
}

interface CreateOpts extends UpsertWebhookInput {
  kind: 'self' | 'manual';
  lookup?: LookupFn;
}

/**
 * Self (plugin) webhooks: one per project — re-registering the same url
 * rotates the secret, a new url replaces the previous self webhook. Manual
 * webhooks: one per url. The secret is returned exactly once.
 */
async function createOrRotate(projectId: string, opts: CreateOpts): Promise<UpsertWebhookResult> {
  if (!hasSecretBoxKey()) return { ok: false, reason: 'sealing_unavailable' };
  const checked = await checkWebhookUrl(opts.url, opts.lookup);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const url = checked.url.toString();
  const urlHash = hashWebhookUrl(url);
  const events = opts.events && opts.events.length ? opts.events : [...WEBHOOK_EVENTS];
  const secret = generateWebhookSecret();
  const fresh = {
    url,
    urlHash,
    kind: opts.kind,
    secretCiphertext: sealSecret(secret),
    events,
    enabled: true,
    failureStreak: 0,
    failingSince: null,
    lastStatus: null,
    disabledAt: null,
    createdBy: opts.createdBy ?? null
  };

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(outboundWebhooks)
      .where(
        and(
          eq(outboundWebhooks.projectId, projectId),
          opts.kind === 'self'
            ? inArray(outboundWebhooks.kind, ['self'])
            : eq(outboundWebhooks.urlHash, urlHash)
        )
      );
    const sameUrl = existingRows.find((r) => r.urlHash === urlHash);
    const toDelete = existingRows.filter((r) => r.id !== sameUrl?.id);
    if (toDelete.length) {
      await tx.delete(outboundWebhooks).where(
        inArray(
          outboundWebhooks.id,
          toDelete.map((r) => r.id)
        )
      );
    }
    if (sameUrl) {
      await tx.update(outboundWebhooks).set(fresh).where(eq(outboundWebhooks.id, sameUrl.id));
      return { ok: true, id: sameUrl.id, secret, rotated: true };
    }
    const id = randomUUID();
    await tx.insert(outboundWebhooks).values({ id, projectId, ...fresh });
    return { ok: true, id, secret, rotated: false };
  });
}

export function upsertSelfWebhook(
  projectId: string,
  input: UpsertWebhookInput,
  lookup?: LookupFn
): Promise<UpsertWebhookResult> {
  return createOrRotate(projectId, { ...input, kind: 'self', lookup });
}

export function createManualWebhook(
  projectId: string,
  input: UpsertWebhookInput,
  lookup?: LookupFn
): Promise<UpsertWebhookResult> {
  return createOrRotate(projectId, { ...input, kind: 'manual', lookup });
}

export async function deleteSelfWebhook(projectId: string): Promise<boolean> {
  const [res] = await db
    .delete(outboundWebhooks)
    .where(and(eq(outboundWebhooks.projectId, projectId), eq(outboundWebhooks.kind, 'self')));
  return res.affectedRows > 0;
}

export async function deleteWebhook(projectId: string, id: string): Promise<boolean> {
  const [res] = await db
    .delete(outboundWebhooks)
    .where(and(eq(outboundWebhooks.projectId, projectId), eq(outboundWebhooks.id, id)));
  return res.affectedRows > 0;
}

export async function getSelfWebhook(projectId: string): Promise<OutboundWebhookView | null> {
  const [row] = await db
    .select()
    .from(outboundWebhooks)
    .where(and(eq(outboundWebhooks.projectId, projectId), eq(outboundWebhooks.kind, 'self')));
  return row ? toWebhookView(row) : null;
}

export async function getWebhook(
  projectId: string,
  id: string
): Promise<OwnedWebhookResult<OutboundWebhookView>> {
  const [row] = await db
    .select()
    .from(outboundWebhooks)
    .where(and(eq(outboundWebhooks.projectId, projectId), eq(outboundWebhooks.id, id)));
  return row ? { ok: true, value: toWebhookView(row) } : { ok: false, reason: 'not_found' };
}

export async function listWebhooks(projectId: string): Promise<OutboundWebhookView[]> {
  const rows = await db
    .select()
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.projectId, projectId))
    .orderBy(desc(outboundWebhooks.createdAt));
  return rows.map(toWebhookView);
}

/** Newest first across every webhook of the project (or one webhook). */
export async function listDeliveries(
  projectId: string,
  limit: number,
  webhookId?: string
): Promise<WebhookDeliveryView[]> {
  const take = Math.min(Math.max(limit, 1), MAX_DELIVERIES_PAGE);
  const where = [eq(outboundWebhooks.projectId, projectId)];
  if (webhookId) where.push(eq(webhookDeliveries.webhookId, webhookId));
  const rows = await db
    .select({ d: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(outboundWebhooks, eq(outboundWebhooks.id, webhookDeliveries.webhookId))
    .where(and(...where))
    .orderBy(desc(webhookDeliveries.id))
    .limit(take);
  return rows.map((r) => toDeliveryView(r.d));
}
