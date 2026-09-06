/**
 * Who the walkthrough opens for.
 *
 * The rule has two halves and only one of them is about store count: it opens
 * BY ITSELF on a first store, and it opens ON REQUEST for anyone. Getting
 * that wrong in either direction is a real bug — an overlay over the
 * catalogue of a merchant running ten shops, or a "replay" button that does
 * nothing for exactly the people who click it.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadTourState } from '@/features/guided-tour/api/state';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let userId: string;

beforeEach(async () => {
  await resetTables();
  userId = await createUser();
});
afterAll(async () => {
  await db.$client.end();
});

const set = (v: Partial<typeof users.$inferInsert>) =>
  db.update(users).set(v).where(eq(users.id, userId));

describe('loadTourState', () => {
  it('opens at the beginning for an account with no store yet', async () => {
    const state = await loadTourState(userId);
    expect(state).toEqual({ step: 'welcome', siteId: null, chapter: null });
  });

  it('carries the only store, so "Next" can walk to it', async () => {
    const projectId = await createProject(userId);
    expect(await loadTourState(userId)).toEqual({
      step: 'welcome',
      siteId: projectId,
      chapter: null
    });
  });

  it('resumes where the merchant stopped', async () => {
    await createProject(userId);
    await set({ tourStep: 'generate' });
    expect((await loadTourState(userId))?.step).toBe('generate');
  });

  it('a step id we no longer ship falls back to the first one', async () => {
    await set({ tourStep: 'a-step-from-a-previous-version' });
    expect((await loadTourState(userId))?.step).toBe('welcome');
  });

  it('stays shut once it has been finished or skipped', async () => {
    await set({ tourEndedAt: new Date(), tourStep: 'apply' });
    expect(await loadTourState(userId)).toBeNull();
  });

  it('never opens by itself on an account that already runs several stores', async () => {
    await createProject(userId);
    await createProject(userId);
    expect(await loadTourState(userId)).toBeNull();
  });

  it('but opens for them the moment they ask for it', async () => {
    await createProject(userId);
    await createProject(userId);
    await set({ tourStep: 'welcome', tourEndedAt: null });
    expect((await loadTourState(userId))?.step).toBe('welcome');
  });

  it('a replayed chapter opens on that chapter, not at the beginning', async () => {
    await set({ tourStep: 'connect', tourChapter: 'connect', tourEndedAt: null });
    expect(await loadTourState(userId)).toMatchObject({ step: 'connect', chapter: 'connect' });
  });

  it('a step left over from another chapter restarts the replayed one', async () => {
    // "Replay the photos" after stopping mid-audit: resuming at `score` would
    // play a step this run does not contain.
    await set({ tourStep: 'score', tourChapter: 'photos', tourEndedAt: null });
    expect((await loadTourState(userId))?.step).toBe('photos');
  });

  it('a chapter we no longer ship falls back to the whole walkthrough', async () => {
    await set({ tourStep: 'welcome', tourChapter: 'retired-chapter' });
    expect(await loadTourState(userId)).toMatchObject({ step: 'welcome', chapter: null });
  });
});
