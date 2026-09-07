import { eq } from 'drizzle-orm';
import { db } from '@/shared/db';
import { audits, projects } from '@/shared/db/schema';

/**
 * Resolve the language code that drives every AI generation on a project.
 *
 * Priority:
 *   1. projectId is null → 'en' (legacy anon audits / orphan jobs).
 *   2. projects.languageOverride if non-empty.
 *   3. projects.storeLanguage — what the connected platform says the
 *      storefront speaks (see entities/project setStoreLanguage).
 *   4. Latest audit's summary.detectedLanguage for the project (content guess).
 *   5. 'en'.
 *
 * The nullable signature reflects the schema — both audits.projectId and
 * jobs.projectId are nullable.
 */
export async function getEffectiveLanguage(projectId: string | null): Promise<string> {
  if (!projectId) return 'en';

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { languageOverride: true, storeLanguage: true }
  });
  const override = project?.languageOverride?.trim();
  if (override) return override;
  const store = project?.storeLanguage?.trim();
  if (store) return store;

  // Two-step lookup: pick the latest audit id by tiny projection,
  // then fetch only `summary` by primary key. Avoids filesort on the
  // multi-MB JSON column.
  const { findLatestAuditIdWhere } = await import('../api/find-latest');
  const latestId = await findLatestAuditIdWhere(eq(audits.projectId, projectId));
  if (!latestId) return 'en';
  const latest = await db.query.audits.findFirst({
    where: eq(audits.id, latestId),
    columns: { summary: true }
  });
  const summary = (latest?.summary ?? null) as { detectedLanguage?: string | null } | null;
  return summary?.detectedLanguage?.trim() || 'en';
}
