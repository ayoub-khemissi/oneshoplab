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
    showOnHome: boolean;
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
  /** Full URL of the merchant's storefront — used to make the header
   *  domain clickable. Falls back to https://{domain} when the
   *  project / audit didn't capture an explicit URL. */
  siteUrl: string;
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

  const domain = project.domain ?? audit.url ?? '';
  const siteUrl =
    project.url ??
    audit.url ??
    (domain ? `https://${domain.replace(/^https?:\/\//, '')}` : '');
  return {
    domain,
    siteUrl,
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

// ---------------------------------------------------------------------------
// Home-page showcase data
// ---------------------------------------------------------------------------

export interface HomeShowcaseCard {
  /** Token used in the /share/[token] URL the prospect clicks. */
  token: string;
  domain: string;
  siteUrl: string;
  /** Both products from the share link with full before/after data:
   *  source + AI title, description, tags, plus image arrays for the
   *  carousel-style browsing on the home strip. */
  products: Array<{
    sourceId: string;
    sourceTitle: string;
    /** Direct product URL on the merchant's storefront (when the audit
     *  summary captured one). Drives the clickable title link in the
     *  home card; falls back to siteUrl when missing. */
    productUrl: string | null;
    aiTitle: string | null;
    sourceDescriptionHtml: string;
    aiDescriptionHtml: string | null;
    sourceTags: string[];
    aiTags: string[];
    sourceImages: Array<{ src: string; alt: string | null }>;
    aiImages: Array<{ src: string; alt: string | null }>;
  }>;
}

interface LoadHomeShowcaseCardsOptions {
  /** Two-letter UI locale of the visitor (e.g. 'fr', 'en'). Showcase
   *  cards whose effective language matches are surfaced first; English
   *  cards are the next-best fallback; everything else trails. */
  preferredLocale?: string;
  /** Hard cap on the number of cards returned. The visual strip starts
   *  to feel crowded past 6. */
  limit?: number;
}

/**
 * Active share links the admin has flagged as `showOnHome`. Powers the
 * <ShowcaseSection> on the landing page. Returns an empty array when
 * no links are flagged so the section self-hides.
 *
 * Tiered language sort (match → en → others), recency-DESC within each
 * tier. We pull a wider pool than the final `limit` so the locale match
 * isn't accidentally truncated by the SQL ORDER BY before sorting.
 */
export async function loadHomeShowcaseCards(
  opts: LoadHomeShowcaseCardsOptions = {}
): Promise<HomeShowcaseCard[]> {
  const limit = opts.limit ?? 6;
  // Pool size: well over the cap so the locale tier still has candidates
  // when the latest few links happen to be in a different language.
  const POOL_SIZE = Math.max(limit * 5, 30);

  const links = await db.query.shareLinks.findMany({
    where: and(eq(shareLinks.showOnHome, true), isNull(shareLinks.revokedAt)),
    orderBy: [desc(shareLinks.createdAt)],
    limit: POOL_SIZE
  });
  if (links.length === 0) return [];

  // Locale matching is two-letter prefix only. Treats 'fr-CA', 'fr-FR',
  // and 'fr' as equivalent — same for the English fallback. Anything we
  // can't classify lands in the "other" tier.
  const userLang = (opts.preferredLocale ?? 'en').toLowerCase().split(/[-_]/)[0];
  const tierOf = (lang: string | null | undefined): number => {
    if (!lang) return 2;
    const l = lang.toLowerCase().split(/[-_]/)[0];
    if (l === userLang) return 0;
    if (l === 'en') return 1;
    return 2;
  };

  const enriched: Array<{
    card: HomeShowcaseCard;
    lang: string | null;
    createdAt: Date;
  }> = [];

  for (const link of links) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, link.projectId)
    });
    if (!project) continue;
    const audit = await db.query.audits.findFirst({
      where: eq(audits.projectId, project.id),
      orderBy: [desc(audits.createdAt)]
    });
    if (!audit?.summary) continue;

    const summary = audit.summary as {
      allProducts?: Array<{
        sourceId?: string | null;
        handle?: string | null;
        title: string;
        url?: string | null;
        descriptionHtml?: string;
        images?: Array<{ src: string; alt?: string | null }>;
        signals?: { tags?: string[] };
      }>;
      detectedLanguage?: string | null;
    };
    const allProducts = summary.allProducts ?? [];
    // Effective language = explicit override on the project takes
    // precedence, otherwise we trust whatever the audit detected. Null
    // means we couldn't classify — the card lands in the "other" tier.
    const effectiveLanguage = project.languageOverride ?? summary.detectedLanguage ?? null;
    const ids = (link.productSourceIds as string[]) ?? [];

    const products: HomeShowcaseCard['products'] = [];
    for (const sourceId of ids) {
      const matched = allProducts.find(
        (p) => (p.sourceId ?? p.handle ?? '') === sourceId
      );
      if (!matched) continue;
      const [titleHist, descHist, tagsHist, imageJobs] = await Promise.all([
        listOptimHistory(project.id, sourceId, 'title'),
        listOptimHistory(project.id, sourceId, 'description'),
        listOptimHistory(project.id, sourceId, 'tags'),
        listProductImageJobs(project.id, sourceId)
      ]);
      const aiTitle =
        titleHist[0] && typeof titleHist[0].output === 'string'
          ? titleHist[0].output
          : null;
      const aiDescriptionHtml =
        descHist[0] && typeof descHist[0].output === 'string'
          ? descHist[0].output
          : null;
      const aiTags = Array.isArray(tagsHist[0]?.output)
        ? (tagsHist[0]!.output as string[])
        : [];
      const aiImages = imageJobs
        .filter((j) => j.status === 'completed' && j.imageUrl)
        .slice(0, 3)
        .map((j, i) => ({
          src: j.imageUrl!,
          alt: `AI image ${i + 1}`
        }));
      const sourceImages = (matched.images ?? []).slice(0, 3).map((img) => ({
        src: img.src,
        alt: img.alt ?? null
      }));
      products.push({
        sourceId,
        sourceTitle: matched.title,
        productUrl: matched.url ?? null,
        aiTitle,
        sourceDescriptionHtml: matched.descriptionHtml ?? '',
        aiDescriptionHtml,
        sourceTags: matched.signals?.tags ?? [],
        aiTags,
        sourceImages,
        aiImages
      });
    }

    if (products.length === 0) continue;

    const domain = project.domain ?? audit.url ?? '';
    const siteUrl =
      project.url ??
      audit.url ??
      (domain ? `https://${domain.replace(/^https?:\/\//, '')}` : '');

    enriched.push({
      card: {
        token: link.id,
        domain,
        siteUrl,
        products
      },
      lang: effectiveLanguage,
      createdAt: link.createdAt
    });
  }

  // Tier sort: locale match first, then English fallback, then the
  // rest. Within each tier preserve recency DESC. JS sort is stable on
  // Node 12+, so equal `tierOf` keys keep their input order — but we
  // sort by createdAt explicitly to be defensive against driver-level
  // reordering of the underlying findMany result.
  enriched.sort((a, b) => {
    const tDiff = tierOf(a.lang) - tierOf(b.lang);
    if (tDiff !== 0) return tDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return enriched.slice(0, limit).map((e) => e.card);
}
