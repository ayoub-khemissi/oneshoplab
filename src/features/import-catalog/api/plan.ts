import { and, eq, ne, sql } from 'drizzle-orm';
import { maxProductsForPlan } from '@/entities/ai-model';
import { ApiError } from '@/shared/api';
import { db } from '@/shared/db';
import { products, projects, users } from '@/shared/db/schema';
import { indexExisting, planImport, type ImportPlan } from '../lib/dedupe';
import { normalizeRow } from '../lib/normalize';
import { parseCsv, type CsvIssue, type ParsedCsv } from '../lib/parse-csv';
import type { ColumnMapping } from '../model/fields';
import type { ImportRequest } from '../model/request';

export interface ResolvedPlan {
  parsed: ParsedCsv;
  plan: ImportPlan;
  /** Products the plan allows on this site, minus what is already there. */
  room: number;
}

function toMapping(raw: ImportRequest['mapping']): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const [col, field] of Object.entries(raw)) mapping[Number(col)] = field;
  return mapping;
}

/**
 * Parse, validate and plan an import against the site's current catalogue.
 * Shared by preview and commit so the two can never disagree: the commit is
 * simply the plan the merchant just saw, recomputed on their file.
 *
 * Two queries whatever the file size: the existing products' match keys in
 * one go, and the count for the plan ceiling. Never one per row.
 */
export async function resolvePlan(projectId: string, req: ImportRequest): Promise<ResolvedPlan> {
  const parsed = parseCsv(req.csv, { delimiter: req.delimiter });
  const mapping = toMapping(req.mapping);

  const validations = parsed.rows.map((cells, i) =>
    normalizeRow(cells, mapping, i + 1, { requireImage: false })
  );

  const [existingRows, [{ active } = { active: 0 }], [owner]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        handle: products.handle,
        title: products.title
      })
      .from(products)
      .where(eq(products.projectId, projectId)),
    db
      .select({ active: sql<number>`count(*)` })
      .from(products)
      .where(and(eq(products.projectId, projectId), ne(products.status, 'archived'))),
    db
      .select({ plan: users.plan, source: projects.source })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.id, projectId))
  ]);

  // Belt and braces under the route guard: whoever calls this — a route today,
  // maybe a server action tomorrow — cannot import into a connected store.
  if (owner?.source !== 'manual') {
    throw new ApiError('not_found', 'CSV import is only available for a manual store', 404);
  }

  const room = maxProductsForPlan(owner.plan) - Number(active);
  const plan = planImport(validations, indexExisting(existingRows), room);
  return { parsed, plan, room };
}

/** File-level issues that make the import pointless before any row is read. */
export function blockingIssues(parsed: ParsedCsv): CsvIssue[] {
  return parsed.issues.filter((i) => i.code === 'empty_file' || i.code === 'header_only');
}
