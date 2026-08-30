import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, shareLinks } from '@/lib/db/schema';
import { listOptimHistory, listProductImageJobs } from '@/lib/ai';
import { resolveFeaturedProduct } from './featured-product';
import type { SharedAuditSnapshot, SharedProduct } from '../model/types';

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
