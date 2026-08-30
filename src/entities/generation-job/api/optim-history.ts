import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { jobs, type JobKind } from '@/shared/db/schema';
import type { ChatOptimField } from '../model/types';

export interface OptimHistoryItem {
  jobId: string;
  field: ChatOptimField | 'images';
  userPrompt: string;
  output: string | string[];
  createdAt: Date;
  /** Credits debited for this generation. Mirrors `jobs.credits_cost`.
   *  Surfaced on the past-generations row so the merchant can see how
   *  much each historical run cost without leaving the page. */
  creditsCost: number;
  /** When the R2 cleanup worker tombstoned this image job. Null for
   *  fresh entries and for non-image fields. Drives the "Image
   *  expirée le …" caption on the past-generations row. */
  expiredAt: Date | null;
}

/**
 * List recent generations for a (project, productSourceId, field) tuple,
 * newest first. Used by the product detail page to render history.
 */
export async function listOptimHistory(
  projectId: string,
  productSourceId: string,
  field: ChatOptimField | 'images'
): Promise<OptimHistoryItem[]> {
  const kind: JobKind | null =
    field === 'title'
      ? 'kie_title'
      : field === 'description'
        ? 'kie_description'
        : field === 'tags'
          ? 'kie_tags'
          : field === 'images'
            ? 'kie_image_edit'
            : null;
  if (!kind) return [];

  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, kind),
      eq(jobs.status, 'completed'),
      // Image jobs the merchant has soft-deleted from the live grid
      // shouldn't reappear under "past generations" either — that would
      // look like a broken delete. The flag is unused on chat jobs so
      // the predicate is a no-op for title / description / tags.
      isNull(jobs.hiddenAt)
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 20
  });

  return candidates
    .filter((j) => {
      const input = j.inputPayload as { productSourceId?: string } | null;
      return input?.productSourceId === productSourceId;
    })
    .map((j) => {
      const input = j.inputPayload as { userPrompt?: string } | null;
      // Image jobs store the kie payload directly (persistedUrls / resultUrls).
      // Chat jobs store { output, raw } with the parsed text/tags in `output`.
      let output: string | string[] = '';
      if (field === 'images') {
        const r = j.result as { persistedUrls?: string[]; resultUrls?: string[] } | null;
        output = r?.persistedUrls ?? [];
      } else {
        const r = j.result as { output?: string | string[] } | null;
        output = r?.output ?? '';
      }
      return {
        jobId: j.id,
        field,
        userPrompt: input?.userPrompt ?? '',
        output,
        createdAt: j.createdAt,
        creditsCost: j.creditsCost ?? 0,
        expiredAt: j.expiredAt ?? null
      };
    });
}

/** Job kinds that surface in the "Past generations" history strip. */
const HISTORY_KINDS: JobKind[] = ['kie_title', 'kie_description', 'kie_tags', 'kie_image_edit'];

/** Field for a given kie_* kind. Inverse of KIND_BY_FIELD plus
 *  the image entry which the chat map doesn't carry. */
function fieldFromKind(kind: JobKind): ChatOptimField | 'images' | null {
  if (kind === 'kie_title') return 'title';
  if (kind === 'kie_description') return 'description';
  if (kind === 'kie_tags') return 'tags';
  if (kind === 'kie_image_edit') return 'images';
  return null;
}

/**
 * Server-paginated past-generations feed. Replaces the 4×
 * `listOptimHistory` merge that loaded ~80 rows just to render
 * the first 15 — this hits the DB twice (count + slice) and
 * lets the page state live in the URL.
 *
 * Filtering by `productSourceId` happens at the DB level via
 * MySQL's `JSON_EXTRACT` on `inputPayload.productSourceId`,
 * so a product with hundreds of historical gens doesn't pull
 * them all into memory just to discard the irrelevant rows.
 */
export async function listOptimHistoryPaginated(
  projectId: string,
  productSourceId: string,
  options: { page: number; perPage: number }
): Promise<{ items: OptimHistoryItem[]; totalItems: number; totalPages: number }> {
  const page = Math.max(1, options.page);
  const perPage = Math.max(1, options.perPage);

  const sourceFilter = sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.inputPayload}, '$.productSourceId')) = ${productSourceId}`;
  const whereExpr = and(
    eq(jobs.projectId, projectId),
    inArray(jobs.kind, HISTORY_KINDS),
    eq(jobs.status, 'completed'),
    isNull(jobs.hiddenAt),
    sourceFilter
  );

  const [totalRow, rows] = await Promise.all([
    db.select({ value: count() }).from(jobs).where(whereExpr),
    db
      .select()
      .from(jobs)
      .where(whereExpr)
      .orderBy(desc(jobs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)
  ]);

  const totalItems = totalRow[0]?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));

  const items: OptimHistoryItem[] = rows
    .map((j) => {
      const field = fieldFromKind(j.kind);
      if (!field) return null;
      const input = j.inputPayload as { userPrompt?: string } | null;
      let output: string | string[] = '';
      if (field === 'images') {
        const r = j.result as { persistedUrls?: string[]; resultUrls?: string[] } | null;
        output = r?.persistedUrls ?? [];
      } else {
        const r = j.result as { output?: string | string[] } | null;
        output = r?.output ?? '';
      }
      return {
        jobId: j.id,
        field,
        userPrompt: input?.userPrompt ?? '',
        output,
        createdAt: j.createdAt,
        creditsCost: j.creditsCost ?? 0,
        expiredAt: j.expiredAt ?? null
      } satisfies OptimHistoryItem;
    })
    .filter((it): it is OptimHistoryItem => it !== null);

  return { items, totalItems, totalPages };
}
