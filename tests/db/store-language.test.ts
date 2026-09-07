/**
 * Effective language of a site: explicit override, then the language the
 * connected platform reports, then the audit's content guess, then English.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getEffectiveLanguage, setStoreLanguage } from '@/entities/audit';
import { db } from '@/shared/db';
import { audits, projects } from '@/shared/db/schema';
import { createUser, resetTables } from './helpers';
import { createProject } from './site-helpers';

let projectId: string;

beforeEach(async () => {
  await resetTables();
  projectId = await createProject(await createUser());
});
afterAll(resetTables);

async function storeLanguage(): Promise<string | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  return row.storeLanguage;
}

describe('setStoreLanguage', () => {
  it('records the platform locale as ISO 639-1 and ignores junk', async () => {
    expect(await setStoreLanguage(projectId, 'fr_FR')).toBe('fr');
    expect(await storeLanguage()).toBe('fr');
    // An unusable tag never wipes what was learned.
    expect(await setStoreLanguage(projectId, 'C')).toBeNull();
    expect(await setStoreLanguage(projectId, null)).toBeNull();
    expect(await storeLanguage()).toBe('fr');
    // A merchant switching their shop language is followed.
    expect(await setStoreLanguage(projectId, 'es-ES')).toBe('es');
    expect(await storeLanguage()).toBe('es');
  });
});

describe('getEffectiveLanguage', () => {
  it('override > store language > audit content guess > en', async () => {
    expect(await getEffectiveLanguage(projectId)).toBe('en');

    await db.insert(audits).values({
      id: randomUUID(),
      url: 'https://shop.example.com',
      domain: 'shop.example.com',
      projectId,
      status: 'completed',
      platform: 'shopify',
      summary: { detectedLanguage: 'it' }
    });
    expect(await getEffectiveLanguage(projectId)).toBe('it');

    await setStoreLanguage(projectId, 'de_DE');
    expect(await getEffectiveLanguage(projectId)).toBe('de');

    await db.update(projects).set({ languageOverride: 'pt' }).where(eq(projects.id, projectId));
    expect(await getEffectiveLanguage(projectId)).toBe('pt');
  });
});
