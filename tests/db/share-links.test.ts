/**
 * Share links: a merchant publishes a public before/after page. Ownership is
 * enforced on every mutation, and a revoked link is dead for the public loader.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted: shared mutable state must come from vi.hoisted.
// Share links are curated by admins only (isAdminEmail); the ownership
// checks on top of that are what these tests exercise.
const session = vi.hoisted(() => ({ userId: null as string | null, admin: true }));
vi.mock('@/lib/auth', () => ({
  auth: async () =>
    session.userId
      ? { user: { id: session.userId, email: session.admin ? 'a@admin.test' : 'u@user.test' } }
      : null
}));
vi.mock('@/lib/admin', () => ({
  isAdminEmail: (e: string | null) => !!e?.endsWith('@admin.test')
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { db } from '@/lib/db';
import { shareLinks } from '@/lib/db/schema';
import {
  createShareLinkAction,
  revokeShareLinkAction,
  setShareLinkShowOnHomeAction
} from '@/features/share-link';
import { loadSharedAudit } from '@/entities/share-link';
import { createUser, resetTables } from './helpers';
import { createProject, createShareLink } from './site-helpers';

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
};

beforeEach(async () => {
  await resetTables();
  session.userId = null;
  session.admin = true;
});
afterAll(async () => {
  await db.$client.end();
});

describe('createShareLinkAction', () => {
  it('requires a session, a site you own and exactly two products', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const siteId = await createProject(owner);

    expect(await createShareLinkAction(form({ siteId, productSourceIds: ['a', 'b'] }))).toEqual({
      ok: false,
      error: 'unauthorized'
    });

    session.userId = owner;
    session.admin = false;
    expect(await createShareLinkAction(form({ siteId, productSourceIds: ['a', 'b'] }))).toEqual({
      ok: false,
      error: 'unauthorized'
    });
    session.admin = true;

    session.userId = stranger;
    expect(await createShareLinkAction(form({ siteId, productSourceIds: ['a', 'b'] }))).toEqual({
      ok: false,
      error: 'site_not_found'
    });

    session.userId = owner;
    expect(await createShareLinkAction(form({ siteId, productSourceIds: ['a'] }))).toEqual({
      ok: false,
      error: 'need_two_products'
    });
    const res = await createShareLinkAction(
      form({ siteId, productSourceIds: ['a', 'b'], label: 'x'.repeat(200), showOnHome: '1' })
    );
    expect(res.ok).toBe(true);
    const [row] = await db.query.shareLinks.findMany();
    expect(row).toMatchObject({ userId: owner, projectId: siteId, showOnHome: true });
    expect(row.productSourceIds).toEqual(['a', 'b']);
    expect((row.label ?? '').length).toBe(120);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('revokeShareLinkAction / loadSharedAudit', () => {
  it('only the owner can revoke; a revoked or unknown token loads nothing', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const siteId = await createProject(owner);
    const linkId = await createShareLink(owner, siteId);

    session.userId = stranger;
    await revokeShareLinkAction(form({ linkId, siteId }));
    expect(
      (await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, linkId) }))!.revokedAt
    ).toBeNull();

    session.userId = owner;
    const res = await revokeShareLinkAction(form({ linkId, siteId }));
    expect(res.ok).toBe(true);
    expect(
      (await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, linkId) }))!.revokedAt
    ).toBeInstanceOf(Date);

    expect(await loadSharedAudit(linkId)).toBeNull();
    expect(await loadSharedAudit('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('a live link without a completed audit yet resolves to null instead of throwing', async () => {
    const owner = await createUser();
    const siteId = await createProject(owner);
    const linkId = await createShareLink(owner, siteId);
    expect(await loadSharedAudit(linkId)).toBeNull();
  });
});

describe('setShareLinkShowOnHomeAction', () => {
  it('toggles the showcase flag for the owner only', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const siteId = await createProject(owner);
    const linkId = await createShareLink(owner, siteId);

    session.userId = stranger;
    await setShareLinkShowOnHomeAction(form({ linkId, siteId, showOnHome: '1' }));
    expect(
      (await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, linkId) }))!.showOnHome
    ).toBe(false);

    session.userId = owner;
    expect((await setShareLinkShowOnHomeAction(form({ linkId, siteId, showOnHome: '1' }))).ok).toBe(
      true
    );
    expect(
      (await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, linkId) }))!.showOnHome
    ).toBe(true);
    await setShareLinkShowOnHomeAction(form({ linkId, siteId, showOnHome: '0' }));
    expect(
      (await db.query.shareLinks.findFirst({ where: eq(shareLinks.id, linkId) }))!.showOnHome
    ).toBe(false);
  });
});
