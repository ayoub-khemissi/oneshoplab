/**
 * Integration API v1 routes called directly with signed `Request`s:
 * auth matrix, catalog sync (partial / paged full / limits / idempotency),
 * archive, changes listing + ack, rate limit.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as ACK } from '@/app/api/v1/changes/[id]/ack/route';
import { GET as CHANGES } from '@/app/api/v1/changes/route';
import { DELETE as ARCHIVE } from '@/app/api/v1/products/[sourceId]/route';
import { POST as SYNC } from '@/app/api/v1/products/sync/route';
import { GET as SITE } from '@/app/api/v1/site/route';
import { buildSignatureHeader, createApiKey, revokeApiKey } from '@/entities/api-key';
import { createChange, hashValue } from '@/entities/product-change';
import { resetRateLimits } from '@/shared/api';
import { db } from '@/shared/db';
import { catalogSyncSessions, products, projects, type ApiKeyPermission } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProduct } from './integration-helpers';
import { createProject } from './site-helpers';

let userId: string;
let projectId: string;
let key: string;

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
  userId = await createUser();
  projectId = await createProject(userId);
  key = await makeKey();
});
afterAll(async () => {
  await db.$client.end();
});

async function makeKey(
  opts: {
    projectId?: string;
    userId?: string;
    permissions?: ApiKeyPermission[];
    expiresAt?: Date;
  } = {}
): Promise<string> {
  const res = await createApiKey({
    projectId: opts.projectId ?? projectId,
    userId: opts.userId ?? userId,
    name: 'plugin',
    permissions: opts.permissions,
    expiresAt: opts.expiresAt
  });
  if (!res.ok) throw new Error('key');
  return res.value.plaintext;
}

interface CallOpts {
  body?: unknown;
  key?: string | null;
  signWith?: string | null;
  t?: number;
  headers?: Record<string, string>;
}

function request(method: string, path: string, opts: CallOpts = {}): Request {
  const body = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const bearer = opts.key === undefined ? key : opts.key;
  const signer = opts.signWith === undefined ? bearer : opts.signWith;
  const headers: Record<string, string> = { ...opts.headers };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (signer) {
    headers['x-osl-signature'] = buildSignatureHeader(
      signer,
      { method, path: new URL(path, 'http://localhost').pathname, body },
      opts.t
    );
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const site = (opts?: CallOpts) => SITE(request('GET', '/api/v1/site', opts)).then(json);
const sync = (body: unknown, opts: CallOpts = {}) =>
  SYNC(
    request('POST', '/api/v1/products/sync', {
      body,
      ...opts,
      headers: { 'idempotency-key': randomUUID(), ...opts.headers }
    })
  ).then(json);
const archive = (sourceId: string, opts?: CallOpts) =>
  ARCHIVE(request('DELETE', `/api/v1/products/${sourceId}`, opts), {
    params: Promise.resolve({ sourceId })
  }).then(json);
const changes = (query = '', opts?: CallOpts) =>
  CHANGES(request('GET', `/api/v1/changes${query}`, opts)).then(json);
const ack = (id: string, body: unknown, opts?: CallOpts) =>
  ACK(request('POST', `/api/v1/changes/${id}/ack`, { body, ...opts }), {
    params: Promise.resolve({ id })
  }).then(json);

const product = (sourceId: string, title = `Title ${sourceId}`) => ({ sourceId, title });

async function statuses(): Promise<Record<string, string>> {
  const rows = await db.select().from(products).where(eq(products.projectId, projectId));
  return Object.fromEntries(rows.map((r) => [r.sourceId, r.status]));
}

describe('GET /site + auth', () => {
  it('200 with site, key and limits', async () => {
    const r = await site();
    expect(r.status).toBe(200);
    expect(r.body.site).toMatchObject({
      id: projectId,
      platform: 'unknown',
      plan: 'free',
      limits: { maxProducts: 200, batchSize: 200 }
    });
    expect(r.body.key).toMatchObject({
      prefix: key.slice(0, 12),
      permissions: ['catalog:write', 'changes:read', 'changes:ack', 'webhooks:manage'],
      expiresAt: null,
      graceUntil: null
    });
    expect(typeof r.body.serverTime).toBe('string');
  });

  it('refuses every broken credential with the right code', async () => {
    const code = async (opts: CallOpts) => {
      const r = await site(opts);
      return `${r.status} ${r.body.error.code}`;
    };
    expect(await code({ key: null })).toBe('401 unauthorized');
    expect(await code({ key: 'osl_live_' + 'x'.repeat(43) })).toBe('401 unauthorized');
    expect(await code({ key: key.slice(0, -1) + (key.endsWith('a') ? 'b' : 'a') })).toBe(
      '401 unauthorized'
    );
    const other = await makeKey();
    expect(await code({ signWith: other })).toBe('401 signature_invalid');
    expect(await code({ signWith: null })).toBe('401 signature_invalid');
    const skew = await site({ t: Math.floor(Date.now() / 1000) - 1000 });
    expect(skew.status).toBe(401);
    expect(skew.body.error.code).toBe('clock_skew');
    expect(typeof skew.body.error.details.serverTime).toBe('number');

    const revoked = await makeKey();
    const [row] = await db
      .select()
      .from((await import('@/shared/db/schema')).apiKeys)
      .where(eq((await import('@/shared/db/schema')).apiKeys.prefix, revoked.slice(0, 12)));
    await revokeApiKey({ keyId: row.id, userId });
    expect(await code({ key: revoked })).toBe('401 key_revoked');
    const expired = await makeKey({ expiresAt: new Date(Date.now() - 1000) });
    expect(await code({ key: expired })).toBe('401 key_expired');

    const readOnly = await makeKey({ permissions: ['changes:read'] });
    const forbidden = await sync({ mode: 'partial', products: [] }, { key: readOnly });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('forbidden');
  });
});

describe('POST /products/sync', () => {
  it('partial: insert then update / unchanged, never archives', async () => {
    const first = await sync(
      { mode: 'partial', products: [product('a'), product('b')] },
      { headers: { 'x-osl-platform': 'woocommerce' } }
    );
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ inserted: 2, updated: 0, archived: 0, unchanged: 0, errors: [] });
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(proj.source).toBe('woocommerce');

    const second = await sync({
      mode: 'partial',
      products: [product('a', 'Renamed'), product('b')]
    });
    expect(second.body).toMatchObject({ inserted: 0, updated: 1, unchanged: 1, archived: 0 });
    await createProduct(projectId, { sourceId: 'c' });
    const third = await sync({ mode: 'partial', products: [product('a', 'Renamed')] });
    expect(third.body).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, archived: 0 });
    expect(await statuses()).toEqual({ a: 'active', b: 'active', c: 'active' });
  });

  it('full: archives the unseen product only on the final page', async () => {
    await sync({ mode: 'partial', products: [product('a'), product('b'), product('c')] });
    const page1 = await sync({ mode: 'full', products: [product('a')] });
    expect(page1.status).toBe(200);
    expect(page1.body.archived).toBe(0);
    expect(typeof page1.body.session).toBe('string');
    expect(await statuses()).toEqual({ a: 'active', b: 'active', c: 'active' });

    const clash = await sync({ mode: 'full', products: [product('b')] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('sync_in_progress');
    const bogus = await sync({ mode: 'full', session: randomUUID(), products: [] });
    expect(bogus.status).toBe(422);

    const page2 = await sync({
      mode: 'full',
      session: page1.body.session,
      final: true,
      products: [product('b')]
    });
    expect(page2.body).toMatchObject({ archived: 1, session: page1.body.session });
    expect(await statuses()).toEqual({ a: 'active', b: 'active', c: 'archived' });
    const reuse = await sync({ mode: 'full', session: page1.body.session, products: [] });
    expect(reuse.status).toBe(422);
  });

  it('full: an abandoned session archives nothing (expired → new session opens)', async () => {
    await sync({ mode: 'partial', products: [product('a'), product('b')] });
    const open = await sync({ mode: 'full', products: [product('a')] });
    await db
      .update(catalogSyncSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(catalogSyncSessions.id, open.body.session));
    const fresh = await sync({ mode: 'full', products: [product('b')] });
    expect(fresh.status).toBe(200);
    expect(fresh.body.session).not.toBe(open.body.session);
    expect(await statuses()).toEqual({ a: 'active', b: 'active' });
  });

  it('422 on a duplicate sourceId with its index', async () => {
    const r = await sync({ mode: 'partial', products: [product('a'), product('b'), product('a')] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation');
    expect(r.body.error.details.issues[0].path).toBe('products.2.sourceId');
    expect(await statuses()).toEqual({});
  });

  it('422 plan_limit when the batch would exceed maxProducts', async () => {
    const batch = Array.from({ length: 200 }, (_, i) => product(`p${i}`));
    expect((await sync({ mode: 'partial', products: batch })).body.inserted).toBe(200);
    const over = await sync({ mode: 'partial', products: [product('p0'), product('new')] });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({
      code: 'plan_limit',
      details: { maxProducts: 200, current: 200 }
    });
    expect((await sync({ mode: 'partial', products: [product('p0', 'x')] })).status).toBe(200);
  });

  it('idempotency: replay returns the cached body, a different body is 409', async () => {
    const headers = { 'idempotency-key': 'k1' };
    const body = { mode: 'partial', products: [product('a')] };
    const first = await sync(body, { headers });
    const replay = await sync(body, { headers });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.inserted).toBe(1);
    const other = await sync({ mode: 'partial', products: [product('b')] }, { headers });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_mismatch');
    const missing = await SYNC(request('POST', '/api/v1/products/sync', { body })).then(json);
    expect(missing.status).toBe(422);
  });
});

describe('DELETE /products/{sourceId}', () => {
  it('archives idempotently, 404 unknown or foreign', async () => {
    await createProduct(projectId, { sourceId: 'a' });
    expect((await archive('a')).body).toMatchObject({ status: 'archived', alreadyArchived: false });
    expect((await archive('a')).body).toMatchObject({ status: 'archived', alreadyArchived: true });
    expect((await statuses()).a).toBe('archived');
    expect((await archive('nope')).status).toBe(404);
    const foreign = await createProject(await createUser(), 'Other');
    await createProduct(foreign, { sourceId: 'theirs' });
    expect((await archive('theirs')).status).toBe(404);
  });
});

describe('changes', () => {
  async function makeChange(sourceId: string, value: unknown = 'New') {
    const p = await createProduct(projectId, { sourceId, title: 'Old title' });
    const res = await createChange({
      projectId,
      productId: p.id,
      productSourceId: sourceId,
      field: 'title',
      value,
      approvedBy: userId
    });
    if (!res.ok) throw new Error('change');
    return res.change.id;
  }

  it('lists oldest first with cursor + limit', async () => {
    const ids = [await makeChange('a'), await makeChange('b'), await makeChange('c')];
    const page1 = await changes('?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.changes.map((c: { id: string }) => c.id)).toEqual(ids.slice(0, 2));
    expect(page1.body.changes[0]).toMatchObject({
      productSourceId: 'a',
      field: 'title',
      value: 'New',
      expiresAt: null
    });
    expect(page1.body.nextCursor).toBe(ids[1]);
    const page2 = await changes(`?limit=2&since=${page1.body.nextCursor}`);
    expect(page2.body.changes.map((c: { id: string }) => c.id)).toEqual([ids[2]]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await changes('?limit=0')).status).toBe(422);
    const noRead = await makeKey({ permissions: ['catalog:write'] });
    expect((await changes('', { key: noRead })).status).toBe(403);
  });

  it('ack: applied, replay, other status 409, conflict, foreign 404', async () => {
    const id = await makeChange('a');
    expect((await ack(id, { status: 'applied' })).body).toEqual({ status: 'applied' });
    expect((await ack(id, { status: 'applied' })).status).toBe(200);
    const diff = await ack(id, { status: 'failed', error: 'boom' });
    expect(diff.status).toBe(409);
    expect(diff.body.error.code).toBe('already_acked');

    const conflicting = await makeChange('b');
    const c = await ack(conflicting, { status: 'applied', storeValueHash: hashValue('Edited') });
    expect(c.body).toEqual({ status: 'conflict' });
    const clean = await makeChange('c');
    const ok = await ack(clean, { status: 'applied', storeValueHash: hashValue('Old title') });
    expect(ok.body).toEqual({ status: 'applied' });

    const foreignKey = await makeKey({ projectId: await createProject(userId, 'Other') });
    const d = await makeChange('d');
    expect((await ack(d, { status: 'applied' }, { key: foreignKey })).status).toBe(404);
    expect((await ack(d, { status: 'nope' })).status).toBe(422);
    expect((await ack(randomUUID(), { status: 'applied' })).status).toBe(404);
  });
});

describe('rate limit', () => {
  it('429 with Retry-After after the bucket is drained', async () => {
    for (let i = 0; i < 60; i++) expect((await site()).status).toBe(200);
    const r = await site();
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('rate_limited');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    resetRateLimits();
    expect((await site()).status).toBe(200);
  });
});
