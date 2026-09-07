import { and, eq, ne, or, isNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { projects } from '@/shared/db/schema';
import { languageCodeFromLocale } from '@/shared/i18n';

/**
 * Record the language a connected platform reports for its storefront —
 * the second rung of getEffectiveLanguage (../lib/language.ts).
 * Connectors call this on every pull with whatever locale tag the platform
 * gave (`fr-FR`, `fr_FR`, `fr`); unknown tags are ignored rather than wiping
 * a value learned earlier. Returns the code persisted, or null when the tag
 * was unusable.
 */
export async function setStoreLanguage(
  projectId: string,
  rawLocale: string | null | undefined
): Promise<string | null> {
  const code = languageCodeFromLocale(rawLocale);
  if (!code) return null;
  await db
    .update(projects)
    .set({ storeLanguage: code })
    .where(
      and(
        eq(projects.id, projectId),
        or(isNull(projects.storeLanguage), ne(projects.storeLanguage, code))
      )
    );
  return code;
}
