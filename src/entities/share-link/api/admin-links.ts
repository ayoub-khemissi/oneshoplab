import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, jobs, projects, shareLinks } from '@/lib/db/schema';

/**
 * Active (non-revoked) share links for one site, freshest first. Used
 * by the admin-only dashboard card to list the URLs they've already
 * generated for prospect outreach.
 */
export async function listShareLinksForSite(
  userId: string,
  projectId: string
): Promise<
  {
    id: string;
    label: string | null;
    showOnHome: boolean;
    homeOrder: number | null;
    createdAt: Date;
    productSourceIds: string[];
  }[]
> {
  const rows = await db.query.shareLinks.findMany({
    where: and(
      eq(shareLinks.userId, userId),
      eq(shareLinks.projectId, projectId),
      isNull(shareLinks.revokedAt)
    ),
    orderBy: [desc(shareLinks.createdAt)]
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    showOnHome: Boolean(r.showOnHome),
    homeOrder: r.homeOrder,
    createdAt: r.createdAt,
    productSourceIds: (r.productSourceIds as string[]) ?? []
  }));
}

/**
 * Admin's list of products on a site that already have at least one
 * completed AI generation (title or description). Used as the source
 * set for the share-link "pick 2 products" picker — there's no point
 * letting the admin pick a product that has nothing to show on the
 * before/after view.
 */
export async function listProductsWithGenerations(projectId: string): Promise<
  {
    sourceId: string;
    title: string;
    hasTitle: boolean;
    hasDescription: boolean;
    hasTags: boolean;
    hasImages: boolean;
  }[]
> {
  // Pull all the project's audit summary products (the canonical set
  // we display anywhere else in the UI). Then for each product, ask
  // listOptimHistory whether anything ran.
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId)
  });
  if (!project) return [];

  const { findLatestAuditIdWhere } = await import('@/entities/audit');
  const auditId = await findLatestAuditIdWhere(eq(audits.projectId, project.id));
  const audit = auditId
    ? await db.query.audits.findFirst({
        where: eq(audits.id, auditId),
        columns: { summary: true }
      })
    : null;
  const summary = audit?.summary as
    | {
        allProducts?: { sourceId?: string | null; handle?: string | null; title: string }[];
      }
    | null
    | undefined;
  const all = summary?.allProducts ?? [];

  const result: {
    sourceId: string;
    title: string;
    hasTitle: boolean;
    hasDescription: boolean;
    hasTags: boolean;
    hasImages: boolean;
  }[] = [];

  // Single bulk query: pull every completed kie_title / description /
  // tags / image_edit job for the project, then bucket in memory by
  // productSourceId. On big catalogs this replaces N × 4 round-trips
  // (5000 products → 20K queries, ~30s) with a single one.
  const completedJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, project.id),
      eq(jobs.status, 'completed'),
      inArray(jobs.kind, ['kie_title', 'kie_description', 'kie_tags', 'kie_image_edit']),
      isNull(jobs.hiddenAt)
    ),
    columns: { kind: true, inputPayload: true, result: true }
  });

  // Map sourceId → the set of kinds it has at least one valid result for.
  // For image jobs, "valid" means status=completed AND result.imageUrl is
  // populated (legacy pre-R2 rows that never got an imageUrl don't count).
  const flagsBySourceId = new Map<
    string,
    {
      title: boolean;
      description: boolean;
      tags: boolean;
      images: boolean;
    }
  >();
  for (const j of completedJobs) {
    const sid =
      j.inputPayload && typeof j.inputPayload === 'object'
        ? ((j.inputPayload as { productSourceId?: string | null }).productSourceId ?? null)
        : null;
    if (!sid) continue;
    const slot = flagsBySourceId.get(sid) ?? {
      title: false,
      description: false,
      tags: false,
      images: false
    };
    if (j.kind === 'kie_title') slot.title = true;
    else if (j.kind === 'kie_description') slot.description = true;
    else if (j.kind === 'kie_tags') slot.tags = true;
    else if (j.kind === 'kie_image_edit') {
      const hasUrl =
        j.result &&
        typeof j.result === 'object' &&
        'imageUrl' in j.result &&
        typeof (j.result as { imageUrl?: unknown }).imageUrl === 'string' &&
        (j.result as { imageUrl: string }).imageUrl.length > 0;
      if (hasUrl) slot.images = true;
    }
    flagsBySourceId.set(sid, slot);
  }

  for (const p of all) {
    const sourceId = p.sourceId ?? p.handle ?? '';
    if (!sourceId) continue;
    const flags = flagsBySourceId.get(sourceId);
    if (!flags) continue;
    if (!flags.title && !flags.description) continue;
    result.push({
      sourceId,
      title: p.title,
      hasTitle: flags.title,
      hasDescription: flags.description,
      hasTags: flags.tags,
      hasImages: flags.images
    });
  }
  return result;
}
