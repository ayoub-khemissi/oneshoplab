import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audits, jobs, products, projects, shareLinks } from '@/lib/db/schema';
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

  const { findLatestAuditIdWhere } = await import('@/lib/audit/find-latest');
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
  /** Optional summary insights surfaced inside the scores card via a
   *  collapsible "See full audit detail" toggle. All fields are
   *  resilient to missing data on legacy audits — `null` means the
   *  audit predates that summary field and the toggle hides the row. */
  details: {
    sampled: number | null;
    avgProductScore: number | null;
    averages: {
      imageCount: number | null;
      descriptionLength: number | null;
      tagCount: number | null;
    };
    distribution: {
      imagesZero: number | null;
      descEmpty: number | null;
      tagsZero: number | null;
      altNone: number | null;
    };
    /** Up to 6 worst-scoring products with their issue codes — used to
     *  illustrate what the audit found without exposing the full list
     *  on a public page. */
    worstProducts: Array<{
      title: string;
      score: number;
      issues: Array<{ code: string; data?: Record<string, string | number> }>;
    }>;
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

  const { findLatestAuditForProject } = await import('@/lib/audit/find-latest');
  const audit = await findLatestAuditForProject(project.id, project.domain);
  if (!audit?.summary) return null;

  const summary = audit.summary as {
    sampled?: number;
    avgProductScore?: number;
    averages?: {
      imageCount?: number;
      descriptionLength?: number;
      tagCount?: number;
    };
    distribution?: {
      imagesZero?: number;
      descEmpty?: number;
      tagsZero?: number;
      altNone?: number;
    };
    worstProducts?: Array<{
      title: string;
      score: number;
      issues?: Array<{ code: string; data?: Record<string, string | number> }>;
    }>;
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
    const matched = await resolveFeaturedProduct(project.id, sourceId, allProducts);
    if (!matched) continue;

    const [titleHist, descHist, tagsHist, images] = await Promise.all([
      listOptimHistory(project.id, sourceId, 'title'),
      listOptimHistory(project.id, sourceId, 'description'),
      listOptimHistory(project.id, sourceId, 'tags'),
      listProductImageJobs(project.id, sourceId)
    ]);
    const aiTitle =
      titleHist[0] && typeof titleHist[0].output === 'string' ? titleHist[0].output : null;
    const aiDescription =
      descHist[0] && typeof descHist[0].output === 'string' ? descHist[0].output : null;
    const aiTags = Array.isArray(tagsHist[0]?.output) ? (tagsHist[0]!.output as string[]) : [];
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
        images: (matched.images ?? []).map((img) => ({
          src: img.src,
          alt: img.alt ?? null
        }))
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
    project.url ?? audit.url ?? (domain ? `https://${domain.replace(/^https?:\/\//, '')}` : '');
  // Build the collapsible "audit detail" block from the persisted
  // summary. Legacy audits without these fields render the toggle but
  // with reduced content — that's fine, the consumer guards each row.
  const details: SharedAuditSnapshot['details'] = {
    sampled: typeof summary.sampled === 'number' ? summary.sampled : null,
    avgProductScore: typeof summary.avgProductScore === 'number' ? summary.avgProductScore : null,
    averages: {
      imageCount: summary.averages?.imageCount ?? null,
      descriptionLength: summary.averages?.descriptionLength ?? null,
      tagCount: summary.averages?.tagCount ?? null
    },
    distribution: {
      imagesZero: summary.distribution?.imagesZero ?? null,
      descEmpty: summary.distribution?.descEmpty ?? null,
      tagsZero: summary.distribution?.tagsZero ?? null,
      altNone: summary.distribution?.altNone ?? null
    },
    worstProducts: (summary.worstProducts ?? []).slice(0, 6).map((p) => ({
      title: p.title,
      score: p.score,
      issues: p.issues ?? []
    }))
  };

  return {
    domain,
    siteUrl,
    platform: audit.platform,
    scores: audit.scores != null ? (audit.scores as SharedAuditSnapshot['scores']) : null,
    details,
    products,
    generatedAt: link.createdAt,
    label: link.label
  };
}

// ---------------------------------------------------------------------------
// Home-page showcase data
// ---------------------------------------------------------------------------

/** Minimal "source" product snapshot the showcase + shared-audit
 *  pages render. Either pulled from the audit summary or, when the
 *  upstream store rotated its product id and the summary no longer
 *  carries that sourceId, recovered from the persistent `products`
 *  table (whose sourceId stays stable across re-scrapes — see
 *  sync-products.ts). The AI side keys off the stored sourceId via
 *  the jobs table, which never rotates, so it keeps resolving even
 *  when the catalog id changed. */
interface FeaturedProductSnapshot {
  title: string;
  url?: string | null;
  descriptionHtml?: string;
  images?: Array<{ src: string; alt?: string | null }>;
  signals?: { tags?: string[] };
}

async function resolveFeaturedProduct(
  projectId: string,
  sourceId: string,
  allProducts: Array<{
    sourceId?: string | null;
    handle?: string | null;
    title: string;
    url?: string | null;
    descriptionHtml?: string;
    images?: Array<{ src: string; alt?: string | null }>;
    signals?: { tags?: string[] };
  }>
): Promise<FeaturedProductSnapshot | null> {
  const fromSummary = allProducts.find((p) => (p.sourceId ?? p.handle ?? '') === sourceId);
  if (fromSummary) return fromSummary;

  // Summary lost it (catalog id rotation / duplicate-handle churn).
  // Three fallbacks, increasingly resilient:
  //   1. products row by current sourceId
  //   2. products row by handle (if the stored id IS a handle)
  //   3. via the jobs table — the AI jobs immutably record the
  //      productSourceId used at generation time and are FK'd
  //      (jobs.product_id, backfilled) to the canonical products
  //      row. This is the ONLY link that survives unbounded
  //      upstream id rotation (WooCommerce re-issuing the catalog
  //      id on every scrape), which is exactly the moycor case.
  let row =
    (await db.query.products.findFirst({
      where: and(eq(products.projectId, projectId), eq(products.sourceId, sourceId))
    })) ??
    (await db.query.products.findFirst({
      where: and(eq(products.projectId, projectId), eq(products.handle, sourceId))
    })) ??
    null;
  if (!row) {
    const job = await db.query.jobs.findFirst({
      where: and(
        eq(jobs.projectId, projectId),
        isNotNull(jobs.productId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.inputPayload}, '$.productSourceId')) = ${sourceId}`
      )
    });
    if (job?.productId) {
      row =
        (await db.query.products.findFirst({
          where: eq(products.id, job.productId)
        })) ?? null;
    }
  }
  if (!row) return null;
  return {
    title: row.title,
    url: row.sourceUrl,
    descriptionHtml: row.descriptionHtml ?? '',
    images: (row.images ?? []) as Array<{ src: string; alt?: string | null }>,
    signals: { tags: (row.tags ?? []) as string[] }
  };
}

export interface HomeShowcaseCard {
  /** Token used in the /share/[token] URL the prospect clicks. */
  token: string;
  domain: string;
  siteUrl: string;
  /** Detected e-commerce platform of the site, when known. Drives the
   *  brand badge in the showcase header (Shopify / WooCommerce / Wix).
   *  Null = `manual` audit or unrecognised platform — no badge shown. */
  platform: 'shopify' | 'woocommerce' | 'wix' | null;
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
  const limit = opts.limit ?? 3;
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
    homeOrder: number | null;
    createdAt: Date;
  }> = [];

  for (const link of links) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, link.projectId)
    });
    if (!project) continue;
    const { findLatestAuditForProject } = await import('@/lib/audit/find-latest');
    const audit = await findLatestAuditForProject(project.id, project.domain);
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
      const matched = await resolveFeaturedProduct(project.id, sourceId, allProducts);
      if (!matched) continue;
      const [titleHist, descHist, tagsHist, imageJobs] = await Promise.all([
        listOptimHistory(project.id, sourceId, 'title'),
        listOptimHistory(project.id, sourceId, 'description'),
        listOptimHistory(project.id, sourceId, 'tags'),
        listProductImageJobs(project.id, sourceId)
      ]);
      const aiTitle =
        titleHist[0] && typeof titleHist[0].output === 'string' ? titleHist[0].output : null;
      const aiDescriptionHtml =
        descHist[0] && typeof descHist[0].output === 'string' ? descHist[0].output : null;
      const aiTags = Array.isArray(tagsHist[0]?.output) ? (tagsHist[0]!.output as string[]) : [];
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
      project.url ?? audit.url ?? (domain ? `https://${domain.replace(/^https?:\/\//, '')}` : '');

    // Audit platforms include 'manual' for hand-typed audits. We only
    // surface a brand badge for the three real e-commerce stacks the
    // adapters cover.
    const platform: HomeShowcaseCard['platform'] =
      audit.platform === 'shopify' || audit.platform === 'woocommerce' || audit.platform === 'wix'
        ? audit.platform
        : null;

    enriched.push({
      card: {
        token: link.id,
        domain,
        siteUrl,
        platform,
        products
      },
      lang: effectiveLanguage,
      homeOrder: link.homeOrder,
      createdAt: link.createdAt
    });
  }

  // Sort key: (tier, homeOrder ASC NULLS LAST, createdAt DESC).
  // Tier ensures language-matched cards always win over the English
  // fallback. Within a tier the admin-curated `home_order` pins the
  // top slots; unranked rows trail in recency order.
  enriched.sort((a, b) => {
    const tDiff = tierOf(a.lang) - tierOf(b.lang);
    if (tDiff !== 0) return tDiff;
    const aOrder = a.homeOrder ?? Number.POSITIVE_INFINITY;
    const bOrder = b.homeOrder ?? Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return enriched.slice(0, limit).map((e) => e.card);
}
