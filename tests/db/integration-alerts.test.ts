/**
 * Integration alerts: bell row + localized email for key expiry (J-7, once),
 * key expired, grace-end revocation (bell only), Shopify token refused (once
 * per invalidation) and sync failure (once per 24 h). Mailer mocked.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/shared/mailer', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

import { KEY_GRACE_MS, createApiKey, rotateApiKey, runIntegrationSweeps } from '@/entities/api-key';
import { connectShopify, getConnection } from '@/entities/shop-connection';
import { ShopifyAdminError, pullShopifyCatalog } from '@/features/shopify-connector';
import type { ShopifyAdminClient } from '@/features/shopify-connector';
import { db } from '@/shared/db';
import { apiKeyEvents, legalConsents, notifications } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { TOKEN, createFakeClient } from './shopify-helpers';
import { createProject } from './site-helpers';

const DAY = 86_400_000;
let userId: string;
let projectId: string;

beforeEach(async () => {
  await resetTables();
  sendMail.mockClear();
  userId = await createUser();
  projectId = await createProject(userId, 'Atelier');
  await db.insert(legalConsents).values({
    id: randomUUID(),
    userId,
    kind: 'signup_tos',
    version: 'test',
    source: `user:${userId}`,
    locale: 'fr'
  });
});
afterAll(async () => {
  await db.$client.end();
});

async function bell() {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.map((r) => r.kind).sort();
}
function mails(): Array<{ to: string; subject: string; text: string; html: string }> {
  return sendMail.mock.calls.map((c) => c[0] as never);
}
async function key(name: string, expiresAt?: Date) {
  const res = await createApiKey({ projectId, userId, name, expiresAt });
  if (!res.ok) throw new Error('create');
  return res.value.key;
}

describe('api-key alerts', () => {
  it('J-7: one expiring email per key, in the stored locale, never twice', async () => {
    const k = await key('plugin-wc', new Date(Date.now() + 3 * DAY));
    await key('far', new Date(Date.now() + 30 * DAY));
    const r1 = await runIntegrationSweeps();
    expect(r1.expiring).toBe(1);
    expect(await bell()).toEqual(['integration_key_expiring']);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].subject).toContain('« plugin-wc »');
    expect(mails()[0].subject).toMatch(/expire dans [34] jours/);
    expect(mails()[0].text).toContain(`/fr/dashboard/sites/${projectId}?tab=integrations`);
    const r2 = await runIntegrationSweeps();
    expect(r2.expiring).toBe(0);
    expect(mails()).toHaveLength(1);
    const events = await db.select().from(apiKeyEvents).where(eq(apiKeyEvents.apiKeyId, k.id));
    expect(events.filter((e) => e.kind === 'expiry_notice')).toHaveLength(1);
  });

  it('expired: bell + email once', async () => {
    await key('old', new Date(Date.now() - 60_000));
    expect((await runIntegrationSweeps()).expired).toBe(1);
    expect(await bell()).toEqual(['integration_key_expired']);
    expect(mails()[0].subject).toContain('a expiré');
    await runIntegrationSweeps();
    expect(mails()).toHaveLength(1);
  });

  it('grace end: revoked alert is bell-only', async () => {
    const k = await key('rotating');
    const rot = await rotateApiKey({ keyId: k.id, userId });
    expect(rot.ok).toBe(true);
    const later = new Date(Date.now() + KEY_GRACE_MS + 60_000);
    expect((await runIntegrationSweeps(later)).graceRevoked).toBe(1);
    expect(await bell()).toEqual(['integration_key_revoked']);
    expect(mails()).toHaveLength(0);
  });
});

describe('shopify connection alerts', () => {
  async function connect() {
    const r = await connectShopify({
      projectId,
      userId,
      shopDomain: 'atelier.myshopify.com',
      accessToken: TOKEN,
      apiVersion: '2025-07'
    });
    if (!r.ok) throw new Error('connect');
  }

  it('token refused: once per invalidation, with the 3 steps, reset by a new token', async () => {
    await connect();
    const fake = createFakeClient([]);
    fake.tokenInvalid = true;
    await pullShopifyCatalog(projectId, () => fake);
    expect((await getConnection(projectId))?.status).toBe('token_invalid');
    expect(await bell()).toEqual(['integration_token_invalid']);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].text).toContain('1. ');
    expect(mails()[0].text).toContain('3. ');
    await pullShopifyCatalog(projectId, () => fake);
    expect(mails()).toHaveLength(1);
    await connect();
    await pullShopifyCatalog(projectId, () => fake);
    expect(mails()).toHaveLength(2);
  });

  it('sync failed (unreachable): at most once per 24 h', async () => {
    await connect();
    const down = new Proxy({} as ShopifyAdminClient, {
      get: () => () => {
        throw new ShopifyAdminError('network', 'Shopify unreachable: ECONNRESET');
      }
    });
    const r = await pullShopifyCatalog(projectId, () => down);
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(await bell()).toEqual(['integration_sync_failed']);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].subject).toContain('Atelier');
    expect(mails()[0].text).toContain('injoignable');
    await pullShopifyCatalog(projectId, () => down);
    expect(mails()).toHaveLength(1);
    const c = await getConnection(projectId);
    expect(c?.lastAlertKind).toBe('integration_sync_failed');
  });
});
