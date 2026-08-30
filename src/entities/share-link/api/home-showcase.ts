import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, shareLinks } from '@/lib/db/schema';
import { listOptimHistory, listProductImageJobs } from '@/lib/ai';
import { resolveFeaturedProduct } from './featured-product';
import type { HomeShowcaseCard } from '../model/types';

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
    const { findLatestAuditForProject } = await import('@/entities/audit');
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
