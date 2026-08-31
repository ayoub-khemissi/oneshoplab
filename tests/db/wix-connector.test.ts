/** Wix: install → callback (token exchange stubbed), disconnect, apply, webhook, actions. */
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/entities/user/api/next-auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null)
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
const fakeState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/wix-connector/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/features/wix-connector/api/client')>();
  return {
    ...mod,
    createWixClient: (opts: unknown) => {
      const c = fakeState.current as FakeWixClient;
      c.lastOptions = opts as FakeWixClient['lastOptions'];
      return c;
    }
  };
});

import { GET as installGet } from '@/app/api/integrations/wix/install/route';
import { GET as callbackGet } from '@/app/api/integrations/wix/callback/route';
import { POST as webhookPost } from '@/app/api/webhooks/wix/route';
import { createChange } from '@/entities/product-change';
import { getConnection, listForApply } from '@/entities/shop-connection';
import {
  WIX_STATE_COOKIE,
  applyWixChanges,
  mapWixProduct,
  pullWixCatalog
} from '@/features/wix-connector';
import {
  disconnectWixAction,
  getWixConnectionAction,
  requestWixPullAction
} from '@/features/wix-connector/actions';
import { db } from '@/shared/db';
import { productChanges, products, shopConnections } from '@/shared/db/schema';
import { WIX_PUBLIC_KEY_PEM, wixWebhookJwt } from '../unit/wix-fixtures';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';
import {
  INSTANCE_ID,
  REFRESH_TOKEN,
  createFakeWixClient,
  fakeWixProduct,
  setWixEnv,
  type FakeWixClient
} from './wix-helpers';

let userId: string;
let projectId: string;
let fake: FakeWixClient;

beforeEach(async () => {
  await resetTables();
  setWixEnv(WIX_PUBLIC_KEY_PEM);
  userId = await createUser();
  session.userId = userId;
  projectId = await createProject(userId);
  fake = createFakeWixClient([
    fakeWixProduct('w-1', { name: 'Old title', ribbon: 'Hot' }),
    fakeWixProduct('w-2')
  ]);
  fakeState.current = fake;
  vi.unstubAllGlobals();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$client.end();
});

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

async function connect() {
  const req = new NextRequest(
    `http://localhost:3030/api/integrations/wix/install?projectId=${projectId}&locale=de`
  );
  const res = await installGet(req);
  const location = new URL(res.headers.get('location')!);
  const cookie = res.cookies.get(WIX_STATE_COOKIE)?.value ?? null;
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ access_token: 'short-lived', refresh_token: REFRESH_TOKEN });
  });
  const cb = new NextRequest(
    `http://localhost:3030/api/integrations/wix/callback?code=c0de&instanceId=${INSTANCE_ID}&state=${location.searchParams.get('state')}`,
    { headers: cookie ? { cookie: `${WIX_STATE_COOKIE}=${cookie}` } : {} }
  );
  return { location, calls, to: new URL((await callbackGet(cb)).headers.get('location')!) };
}

describe('install → callback', () => {
  it('redirects to the Wix installer, exchanges the code, seals the refresh token, queues a pull', async () => {
    const { location, calls, to } = await connect();
    expect(location.origin + location.pathname).toBe('https://www.wix.com/installer/install');
    expect(location.searchParams.get('appId')).toBe('wix-app-id');
    expect(location.searchParams.get('redirectUrl')).toBe(
      'http://localhost:3030/api/integrations/wix/callback'
    );
    expect(calls[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'c0de',
      client_id: 'wix-app-id'
    });
    expect(to.pathname).toBe(`/de/dashboard/sites/${projectId}`);
    expect(to.searchParams.get('connected')).toBe('wix');
    const c = await getConnection(projectId);
    expect(c).toMatchObject({
      platform: 'wix',
      authMode: 'oauth',
      status: 'connected',
      instanceId: INSTANCE_ID,
      shopDomain: 'atelier.wixsite.com',
      shopName: 'Atelier Wix'
    });
    expect(c!.pullRequestedAt).not.toBeNull();
    const [raw] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(raw.refreshTokenCiphertext).toMatch(/^v1:/);
    expect(raw.refreshTokenCiphertext).not.toContain(REFRESH_TOKEN);
    expect(fake.lastOptions).toMatchObject({ refreshToken: REFRESH_TOKEN, appId: 'wix-app-id' });
  });
  it('bad state → error redirect; unconfigured app → 302 error from install', async () => {
    const req = new NextRequest(
      `http://localhost:3030/api/integrations/wix/callback?code=c&instanceId=i&state=forged`
    );
    const to = new URL((await callbackGet(req)).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('bad_state');
    delete process.env.WIX_APP_ID;
    const res = await installGet(
      new NextRequest(`http://localhost:3030/api/integrations/wix/install?projectId=${projectId}`)
    );
    expect(res.headers.get('location')).toContain('error=not_configured');
  });
});

describe('pull / apply / disconnect / actions', () => {
  it('pulls the catalog into the project (source = wix)', async () => {
    await connect();
    const res = await pullWixCatalog(projectId);
    expect(res).toMatchObject({ ok: true, fetched: 2, inserted: 2 });
    const rows = await db.select().from(products).where(eq(products.projectId, projectId));
    expect(rows.map((r) => [r.sourceId, r.productType, r.tags]).sort()).toEqual([
      ['w-1', 'Shirts', ['Hot']],
      ['w-2', 'Shirts', ['New']]
    ]);
  });
  it('applies title / tags(ribbon) / images, conflicts on a store-side edit, stops on 401', async () => {
    await connect();
    const product = await createProduct(projectId, {
      sourceId: 'w-1',
      title: 'Old title',
      tags: ['Hot']
    });
    const mapped = mapWixProduct(fake.products.get('w-1')!, { collections: new Map() });
    await db
      .update(products)
      .set({ descriptionHtml: mapped.descriptionHtml, images: mapped.images })
      .where(eq(products.id, product.id));
    const mk = (field: 'title' | 'tags' | 'images', value: unknown) =>
      createChange({
        projectId,
        productId: product.id,
        productSourceId: 'w-1',
        field,
        value,
        approvedBy: userId
      }).then((r) => (r.ok ? r.change.id : ''));
    const t = await mk('title', 'New title');
    const g = await mk('tags', ['Sale', 'x']);
    const im = await mk('images', [{ src: 'https://cdn.oneshoplab.com/a.jpg', alt: null }]);
    expect((await listForApply('wix')).map((c) => c.projectId)).toEqual([projectId]);
    const r1 = await applyWixChanges(projectId);
    expect(r1.outcomes.map((o) => o.outcome)).toEqual(['applied', 'applied', 'applied']);
    expect(fake.calls.productUpdate).toEqual([
      { id: 'w-1', name: 'New title' },
      { id: 'w-1', ribbon: 'Sale' }
    ]);
    expect(fake.calls.addMedia).toEqual([
      { id: 'w-1', urls: ['https://cdn.oneshoplab.com/a.jpg'] }
    ]);
    const statuses = await db
      .select({ id: productChanges.id, status: productChanges.status })
      .from(productChanges);
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [t]: 'applied',
      [g]: 'applied',
      [im]: 'applied'
    });

    // Merchant edited the title in Wix after approval → conflict, nothing written.
    await db.update(products).set({ title: 'New title' }).where(eq(products.id, product.id));
    const c = await mk('title', 'Third');
    fake.products.get('w-1')!.name = 'Edited in Wix';
    expect((await applyWixChanges(projectId)).outcomes).toEqual([
      { changeId: c, outcome: 'conflict' }
    ]);

    const d = await mk('title', 'Fourth');
    fake.tokenInvalid = true;
    expect((await applyWixChanges(projectId)).outcomes).toEqual([
      { changeId: d, outcome: 'token_invalid', error: expect.any(String) }
    ]);
    expect((await getConnection(projectId))!.status).toBe('token_invalid');
  });
  it('images ops: append + replace run, the verbs Wix has no API for are skipped', async () => {
    await connect();
    const product = await createProduct(projectId, { sourceId: 'w-1', title: 'Old title' });
    const mapped = mapWixProduct(fake.products.get('w-1')!, { collections: new Map() });
    // The fixture has one image (media id `m1`); a second one makes the ops
    // legal at creation (removing one never empties the gallery).
    const images = [
      ...mapped.images,
      {
        src: 'https://static.wixstatic.com/media/2.jpg',
        alt: null,
        width: null,
        height: null,
        position: 1,
        sourceImageId: 'm2'
      }
    ];
    fake.products.get('w-1')!.media = {
      items: [
        ...(fake.products.get('w-1')!.media?.items ?? []),
        { id: 'm2', mediaType: 'image', image: { url: 'https://static.wixstatic.com/media/2.jpg' } }
      ]
    };
    await db
      .update(products)
      .set({ descriptionHtml: mapped.descriptionHtml, images })
      .where(eq(products.id, product.id));

    const res = await createChange({
      projectId,
      productId: product.id,
      productSourceId: 'w-1',
      field: 'images',
      value: {
        v: 1,
        ops: [
          { op: 'append', image: { src: 'https://cdn.oneshoplab.com/gen/a.jpg', alt: null } },
          { op: 'replace', target: 'm2', image: { src: 'https://cdn.oneshoplab.com/gen/b.jpg' } },
          { op: 'reorder', order: ['m1', 'new:0'] },
          { op: 'remove', target: 'gone' }
        ]
      },
      approvedBy: userId
    });
    if (!res.ok) throw new Error('create failed');

    const out = await applyWixChanges(projectId);
    expect(out.outcomes.map((o) => o.outcome)).toEqual(['applied']);
    expect(fake.calls.addMedia).toEqual([
      { id: 'w-1', urls: ['https://cdn.oneshoplab.com/gen/a.jpg'] },
      { id: 'w-1', urls: ['https://cdn.oneshoplab.com/gen/b.jpg'] }
    ]);
    expect(fake.calls.removeMedia).toEqual([{ id: 'w-1', mediaIds: ['m2'] }]);
    const [row] = await db
      .select()
      .from(productChanges)
      .where(eq(productChanges.id, res.change.id));
    // 2 = reorder (Wix Stores v1 has no ordering call), 3 = a target that is gone.
    expect(row.ackPayload).toMatchObject({
      status: 'applied',
      skippedOps: ['2:reorder', '3:remove']
    });
  });

  it('actions: view, pull request, disconnect wipes the refresh token', async () => {
    await connect();
    const view = await getWixConnectionAction(form({ projectId }));
    expect(view).toMatchObject({
      platform: 'wix',
      status: 'connected',
      shopDomain: 'atelier.wixsite.com',
      pullPending: true
    });
    expect(await requestWixPullAction(form({ projectId }))).toEqual({ ok: true });
    expect(await disconnectWixAction(form({ projectId }))).toEqual({ ok: true });
    const [raw] = await db
      .select()
      .from(shopConnections)
      .where(eq(shopConnections.projectId, projectId));
    expect(raw.status).toBe('revoked');
    expect(raw.refreshTokenCiphertext).toBeNull();
    expect(await getWixConnectionAction(form({ projectId }))).toMatchObject({ status: 'revoked' });
    session.userId = await createUser();
    expect(await disconnectWixAction(form({ projectId }))).toEqual({
      ok: false,
      error: 'not_found'
    });
  });
});

describe('POST /api/webhooks/wix', () => {
  const post = (jwt: string) =>
    webhookPost(
      new Request('http://localhost:3030/api/webhooks/wix', { method: 'POST', body: jwt })
    );
  it('401 on a bad signature, 404 on an unknown instance, upserts / archives / revokes', async () => {
    await connect();
    await createProduct(projectId, { sourceId: 'w-1', title: 'Old title' });
    const [h, p] = wixWebhookJwt({
      instanceId: INSTANCE_ID,
      eventType: 'ProductChanged',
      productId: 'w-1'
    }).split('.');
    expect((await post(`${h}.${p}.AAAA`)).status).toBe(401);
    expect(
      (
        await post(
          wixWebhookJwt({ instanceId: 'other', eventType: 'ProductChanged', productId: 'w-1' })
        )
      ).status
    ).toBe(404);

    fake.products.get('w-1')!.name = 'Fresh from Wix';
    const upd = wixWebhookJwt({
      instanceId: INSTANCE_ID,
      eventType: 'ProductChanged',
      productId: 'w-1'
    });
    expect(await (await post(upd)).json()).toMatchObject({ ok: true, action: 'upserted' });
    expect(await (await post(upd)).json()).toMatchObject({ ok: true, replay: true });
    const [row] = await db.select().from(products).where(eq(products.projectId, projectId));
    expect(row.title).toBe('Fresh from Wix');

    expect(
      await (
        await post(
          wixWebhookJwt({ instanceId: INSTANCE_ID, eventType: 'ProductDeleted', productId: 'w-1' })
        )
      ).json()
    ).toMatchObject({ action: 'archived' });
    expect(
      await (await post(wixWebhookJwt({ instanceId: INSTANCE_ID, eventType: 'AppRemoved' }))).json()
    ).toMatchObject({ action: 'revoked' });
    expect((await getConnection(projectId))!.status).toBe('revoked');
  });
});
