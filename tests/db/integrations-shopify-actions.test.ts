/**
 * Wizard server actions of the Shopify branch: ownership through the entity,
 * typed reasons back to the UI, never the token.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () =>
    session.userId ? { user: { id: session.userId, email: 'owner@user.test' } } : null
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/shopify-connector/api/admin-client', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@/features/shopify-connector/api/admin-client')>();
  return {
    ...mod,
    createAdminClient: (opts: unknown) => {
      const c = fakeState.current as FakeAdminClient;
      c.lastOptions = opts as FakeAdminClient['lastOptions'];
      return c;
    }
  };
});

import {
  connectShopifyAction,
  disconnectShopifyAction,
  getShopifyConnectionAction,
  requestShopifyPullAction
} from '@/features/shopify-connector/actions';
import { db } from '@/shared/db';
import { shopConnections } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { API_SECRET, TOKEN, createFakeClient, type FakeAdminClient } from './shopify-helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;
let fake: FakeAdminClient;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const connectForm = (patch: Record<string, string> = {}) =>
  form({ projectId, shopDomain: 'atelier.myshopify.com', accessToken: TOKEN, ...patch });

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
  projectId = await createProject(userId);
  session.userId = userId;
  fake = createFakeClient();
  fakeState.current = fake;
});
afterAll(async () => {
  await db.$client.end();
});

async function rawRow() {
  const [row] = await db
    .select()
    .from(shopConnections)
    .where(eq(shopConnections.projectId, projectId));
  return row;
}

describe('connectShopifyAction', () => {
  it('seals the token, reports connected + shop name, never the token', async () => {
    const res = await connectShopifyAction(connectForm({ apiSecret: API_SECRET }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.connection.status).toBe('connected');
    expect(res.connection.shopName).toBe('Atelier');
    expect(res.connection.hasWebhookSecret).toBe(true);
    expect(res.connection.pullPending).toBe(true);
    expect(JSON.stringify(res)).not.toContain(TOKEN);
    const row = await rawRow();
    expect(row.accessTokenCiphertext).toMatch(/^v1:/);
    expect(row.accessTokenCiphertext).not.toContain(TOKEN);
    expect(row.pullRequestedAt).not.toBeNull();
  });

  it('refuses an invalid domain before any network call', async () => {
    const res = await connectShopifyAction(connectForm({ shopDomain: 'example.com' }));
    expect(res).toEqual({ ok: false, error: 'invalid_domain' });
    expect(fake.lastOptions).toBeNull();
    expect(await rawRow()).toBeUndefined();
  });

  it('maps a 401 to token_invalid', async () => {
    fake.tokenInvalid = true;
    const res = await connectShopifyAction(connectForm());
    expect(res).toEqual({ ok: false, error: 'token_invalid' });
  });

  it('returns not_found for a project of another user', async () => {
    const other = await createUser();
    const foreign = await createProject(other);
    const res = await connectShopifyAction(connectForm({ projectId: foreign }));
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns unauthorized without a session', async () => {
    session.userId = null;
    expect(await connectShopifyAction(connectForm())).toEqual({
      ok: false,
      error: 'unauthorized'
    });
  });
});

describe('disconnect / pull / status', () => {
  beforeEach(async () => {
    const res = await connectShopifyAction(connectForm({ apiSecret: API_SECRET }));
    expect(res.ok).toBe(true);
  });

  it('disconnect wipes the secrets and the webhooks', async () => {
    expect(await disconnectShopifyAction(form({ projectId }))).toEqual({ ok: true });
    const row = await rawRow();
    expect(row.status).toBe('revoked');
    expect(row.accessTokenCiphertext).toBe('');
    expect(row.webhookSecretCiphertext).toBeNull();
    expect(fake.calls.webhookDelete.length).toBeGreaterThan(0);
    const status = await getShopifyConnectionAction(form({ projectId }));
    expect(status?.status).toBe('revoked');
  });

  it('disconnect of a foreign project is refused', async () => {
    session.userId = await createUser();
    expect(await disconnectShopifyAction(form({ projectId }))).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect((await rawRow()).status).toBe('connected');
  });

  it('requestPull sets pullRequestedAt for the owner only', async () => {
    await db
      .update(shopConnections)
      .set({ pullRequestedAt: null })
      .where(eq(shopConnections.projectId, projectId));
    session.userId = await createUser();
    expect(await requestShopifyPullAction(form({ projectId }))).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect((await rawRow()).pullRequestedAt).toBeNull();
    session.userId = userId;
    expect(await requestShopifyPullAction(form({ projectId }))).toEqual({ ok: true });
    expect((await rawRow()).pullRequestedAt).not.toBeNull();
  });

  it('status reports the view without secrets', async () => {
    const status = await getShopifyConnectionAction(form({ projectId }));
    expect(status).toMatchObject({
      status: 'connected',
      shopDomain: 'atelier.myshopify.com',
      shopName: 'Atelier',
      hasWebhookSecret: true
    });
    expect(JSON.stringify(status)).not.toMatch(/ciphertext|shpat_/);
  });
});
