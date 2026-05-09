import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, projects, shareLinks } from '@/lib/db/schema';
import { listOptimHistory, listProductImageJobs } from '@/lib/ai';

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
export async function listProductsWithGenerations(
  projectId: string
): Promise<
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

  const audit = await db.query.audits.findFirst({
    where: eq(audits.projectId, project.id),
    orderBy: [desc(audits.createdAt)]
  });
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

  for (const p of all) {
    const sourceId = p.sourceId ?? p.handle ?? '';
    if (!sourceId) continue;
    const [title, description, tags, images] = await Promise.all([
      listOptimHistory(project.id, sourceId, 'title'),
      listOptimHistory(project.id, sourceId, 'description'),
      listOptimHistory(project.id, sourceId, 'tags'),
      listProductImageJobs(project.id, sourceId)
    ]);
    const hasTitle = title.length > 0;
    const hasDescription = description.length > 0;
    if (!hasTitle && !hasDescription) continue;
    result.push({
      sourceId,
      title: p.title,
      hasTitle,
      hasDescription,
      hasTags: tags.length > 0,
      hasImages: images.some((j) => j.status === 'completed' && j.imageUrl)
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public-share data loader
// ---------------------------------------------------------------------------

export interface SharedProduct {
  sourceId: string;
  /** From the audit summary at the time of viewing — never the raw
   *  productRow stripped, so we get prices, vendor, etc. */
  title: string;
  source: {
    descriptionHtml: string;
    tags: string[];
    images: { src: string; alt: string | null }[];
  };
  ai: {
    title: string | null;
    descriptionHtml: string | null;
    tags: string[];
    imageUrls: string[];
  };
}

export interface SharedAuditSnapshot {
  /** Site domain shown in the case-study header. */
  domain: string;
  platform: string | null;
  scores: {
    catalogCompleteness: number;
    copyQuality: number;
    visualQuality: number;
    taggingQuality: number;
    overall: number;
  } | null;
  products: SharedProduct[];
  /** When the share link was created — surfaced as "Generated on {date}". */
  generatedAt: Date;
  label: string | null;
}

/**
 * Load everything needed to render a public /share/[token] page in a
 * single call. Returns null when the token is unknown / revoked /
 * the underlying site no longer exists. The caller renders a 404 in
 * that case.
 */
export async function loadSharedAudit(token: string): Promise<SharedAuditSnapshot | null> {
  const link = await db.query.shareLinks.findFirst({
    where: and(eq(shareLinks.id, token), isNull(shareLinks.revokedAt))
  });
  if (!link) return null;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, link.projectId)
  });
  if (!project) return null;

  const audit = await db.query.audits.findFirst({
    where: eq(audits.projectId, project.id),
    orderBy: [desc(audits.createdAt)]
  });
  if (!audit?.summary) return null;

  const summary = audit.summary as {
    allProducts?: Array<{
      sourceId?: string | null;
      handle?: string | null;
      title: string;
      descriptionHtml?: string;
      images?: Array<{ src: string; alt: string | null }>;
      signals?: { tags?: string[] };
    }>;
  };
  const allProducts = summary.allProducts ?? [];
  const productSourceIds = (link.productSourceIds as string[]) ?? [];

  const products: SharedProduct[] = [];
  for (const sourceId of productSourceIds) {
    const matched = allProducts.find(
      (p) => (p.sourceId ?? p.handle ?? '') === sourceId
    );
    if (!matched) continue;

    const [titleHist, descHist, tagsHist, images] = await Promise.all([
      listOptimHistory(project.id, sourceId, 'title'),
      listOptimHistory(project.id, sourceId, 'description'),
      listOptimHistory(project.id, sourceId, 'tags'),
      listProductImageJobs(project.id, sourceId)
    ]);
    const aiTitle =
      titleHist[0] && typeof titleHist[0].output === 'string'
        ? titleHist[0].output
        : null;
    const aiDescription =
      descHist[0] && typeof descHist[0].output === 'string'
        ? descHist[0].output
        : null;
    const aiTags = Array.isArray(tagsHist[0]?.output)
      ? (tagsHist[0]!.output as string[])
      : [];
    const aiImageUrls = images
      .filter((j) => j.status === 'completed' && j.imageUrl)
      .slice(0, 3)
      .map((j) => j.imageUrl!) as string[];

    products.push({
      sourceId,
      title: matched.title,
      source: {
        descriptionHtml: matched.descriptionHtml ?? '',
        tags: matched.signals?.tags ?? [],
        images: matched.images ?? []
      },
      ai: {
        title: aiTitle,
        descriptionHtml: aiDescription,
        tags: aiTags,
        imageUrls: aiImageUrls
      }
    });
  }

  return {
    domain: project.domain ?? audit.url ?? '',
    platform: audit.platform,
    scores:
      audit.scores != null
        ? (audit.scores as SharedAuditSnapshot['scores'])
        : null,
    products,
    generatedAt: link.createdAt,
    label: link.label
  };
}
