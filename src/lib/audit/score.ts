import type { NormalizedProduct } from '@/lib/adapters/types';
import type {
  AuditDistribution,
  AuditReport,
  AuditScores,
  CountedValue,
  Issue,
  ProductInsight
} from './types';

const WORST_N = 10;
const BEST_N = 5;
const LATEST_N = 3;

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function tally(items: string[]): CountedValue[] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return Array.from(m, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function scoreProduct(p: NormalizedProduct): ProductInsight {
  const text = htmlToText(p.descriptionHtml);
  const titleLen = p.title.length;
  const descLen = text.length;
  const imageCount = p.images.length;
  const imagesWithAlt = p.images.filter((i) => i.alt && i.alt.trim().length > 0).length;
  const tagCount = p.tags.length;
  const variantCount = p.variants.length;
  const widths = p.images.map((i) => i.width).filter((w): w is number => w != null && w > 0);
  const minWidth = widths.length > 0 ? Math.min(...widths) : null;
  const structured = /<(ul|ol|li|h[1-6]|table)/i.test(p.descriptionHtml);

  const issues: Issue[] = [];
  if (imageCount === 0) issues.push({ code: 'no_image' });
  else if (imageCount === 1) issues.push({ code: 'single_image' });
  if (descLen === 0) issues.push({ code: 'no_description' });
  else if (descLen < 100) issues.push({ code: 'short_description' });
  else if (!structured && descLen < 300) issues.push({ code: 'unstructured_description' });
  if (titleLen > 0 && titleLen < 20) issues.push({ code: 'short_title' });
  if (tagCount === 0) issues.push({ code: 'no_tags' });
  if (imageCount > 0 && imagesWithAlt < imageCount) {
    issues.push({
      code: 'missing_alt_text',
      data: { missing: imageCount - imagesWithAlt, total: imageCount }
    });
  }
  if (minWidth !== null && minWidth < 800) {
    issues.push({ code: 'low_resolution_image', data: { width: minWidth } });
  }

  const imgScore =
    imageCount >= 4 ? 100 : imageCount === 3 ? 85 : imageCount === 2 ? 65 : imageCount === 1 ? 35 : 0;
  const descScore =
    descLen === 0 ? 0 : descLen < 100 ? 25 : descLen < 300 ? 60 : descLen < 600 ? 85 : 100;
  const structureBonus = structured ? 1 : 0.85;
  const tagScore = tagCount >= 5 ? 100 : tagCount >= 3 ? 70 : tagCount >= 1 ? 40 : 0;
  const titleScore =
    titleLen >= 30 && titleLen <= 70 ? 100 : titleLen >= 20 ? 70 : titleLen > 0 ? 40 : 0;
  const altScore = imageCount === 0 ? 0 : (imagesWithAlt / imageCount) * 100;

  const score = Math.round(
    clamp(
      0.30 * imgScore +
        0.30 * descScore * structureBonus +
        0.15 * tagScore +
        0.15 * titleScore +
        0.10 * altScore
    )
  );

  return {
    sourceId: p.sourceId,
    handle: p.handle,
    title: p.title,
    url: p.sourceUrl,
    descriptionHtml: p.descriptionHtml,
    images: p.images,
    variants: p.variants,
    score,
    issues,
    signals: {
      titleLength: titleLen,
      descriptionTextLength: descLen,
      descriptionHasStructure: structured,
      imageCount,
      imagesWithAlt,
      smallestImageWidth: minWidth,
      variantCount,
      tagCount,
      tags: p.tags,
      vendor: p.vendor,
      productType: p.productType,
      priceMin: p.priceMin,
      priceMax: p.priceMax,
      sourceUpdatedAt: p.sourceUpdatedAt
    }
  };
}

function emptyDistribution(): AuditDistribution {
  return {
    imagesZero: 0,
    imagesOne: 0,
    imagesTwo: 0,
    imagesThreePlus: 0,
    descEmpty: 0,
    descShortLt100: 0,
    descMedium100To500: 0,
    descLongGt500: 0,
    descStructured: 0,
    descPlainWall: 0,
    tagsZero: 0,
    tagsOneToThree: 0,
    tagsFourToTen: 0,
    tagsElevenPlus: 0,
    altNone: 0,
    altPartial: 0,
    altFull: 0
  };
}

function emptyReport(): AuditReport {
  return {
    sampled: 0,
    avgProductScore: 0,
    scores: {
      catalogCompleteness: 0,
      copyQuality: 0,
      visualQuality: 0,
      taggingQuality: 0,
      overall: 0
    },
    averages: { imageCount: 0, descriptionLength: 0, tagCount: 0, variantCount: 0, titleLength: 0 },
    lastProductUpdated: null,
    lowResImageCount: 0,
    distribution: emptyDistribution(),
    topVendors: [],
    topProductTypes: [],
    topTags: [],
    worstProducts: [],
    bestProducts: [],
    latestProducts: [],
    allProducts: [],
    detectedLanguage: null
  };
}

/**
 * Pick the N most recently posted products. Prefers sourceUpdatedAt desc when
 * available across the catalog. Falls back to the catalog tail (assumes the
 * adapter yields oldest-first; for many storefronts this is still a useful
 * proxy for "recent").
 */
function pickLatestProducts(
  insights: ProductInsight[],
  n: number
): ProductInsight[] {
  const dated = insights.filter((p) => p.signals.sourceUpdatedAt != null);
  if (dated.length >= n) {
    return [...dated]
      .sort((a, b) => {
        const aT = a.signals.sourceUpdatedAt!.getTime();
        const bT = b.signals.sourceUpdatedAt!.getTime();
        return bT - aT;
      })
      .slice(0, n);
  }
  // Fallback: tail of the catalog reversed (most recently fetched first)
  return [...insights].reverse().slice(0, n);
}

/**
 * Crude language detection from a sample of product descriptions/titles —
 * good enough to choose the language for AI-generated copy. We compare
 * frequency of common stopwords across a few European languages.
 */
function detectLanguage(insights: ProductInsight[]): string | null {
  const text = insights
    .slice(0, 20)
    .map((p) => `${p.title} ${p.descriptionHtml.replace(/<[^>]+>/g, ' ')}`)
    .join(' ')
    .toLowerCase();
  if (text.length < 100) return null;

  const tokens = text.match(/\b[a-zàâäéèêëïîôöùûüç]+\b/g) ?? [];
  const stopwords: Record<string, string[]> = {
    en: ['the', 'and', 'with', 'for', 'this', 'that', 'from', 'your'],
    fr: ['le', 'la', 'les', 'des', 'une', 'avec', 'pour', 'votre', 'cette', 'sans', 'qui', 'que'],
    es: ['el', 'la', 'los', 'las', 'una', 'con', 'para', 'este', 'que', 'sin'],
    de: ['der', 'die', 'das', 'und', 'mit', 'für', 'eine', 'einen', 'ist', 'nicht'],
    it: ['il', 'la', 'i', 'gli', 'le', 'una', 'con', 'per', 'questo', 'che']
  };

  const scores: Record<string, number> = {};
  for (const [lang, words] of Object.entries(stopwords)) {
    scores[lang] = tokens.filter((t) => words.includes(t)).length;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return null;
  return sorted[0][0];
}

/**
 * Compute an audit report from a normalized product catalog.
 * Pure function — no I/O, no side effects.
 */
export function audit(products: NormalizedProduct[]): AuditReport {
  if (products.length === 0) return emptyReport();

  const insights = products.map(scoreProduct);
  const sorted = [...insights].sort((a, b) => a.score - b.score);

  const dist = emptyDistribution();
  let lowRes = 0;
  let totalImg = 0;
  let totalDesc = 0;
  let totalTags = 0;
  let totalVar = 0;
  let totalTitle = 0;
  let lastUpdated: Date | null = null;
  const allVendors: string[] = [];
  const allTypes: string[] = [];
  const allTags: string[] = [];

  for (const p of insights) {
    const s = p.signals;
    if (s.imageCount === 0) dist.imagesZero++;
    else if (s.imageCount === 1) dist.imagesOne++;
    else if (s.imageCount === 2) dist.imagesTwo++;
    else dist.imagesThreePlus++;

    if (s.descriptionTextLength === 0) dist.descEmpty++;
    else if (s.descriptionTextLength < 100) dist.descShortLt100++;
    else if (s.descriptionTextLength < 500) dist.descMedium100To500++;
    else dist.descLongGt500++;
    if (s.descriptionHasStructure) dist.descStructured++;
    else if (s.descriptionTextLength > 0) dist.descPlainWall++;

    if (s.tagCount === 0) dist.tagsZero++;
    else if (s.tagCount <= 3) dist.tagsOneToThree++;
    else if (s.tagCount <= 10) dist.tagsFourToTen++;
    else dist.tagsElevenPlus++;

    if (s.imageCount === 0 || s.imagesWithAlt === 0) dist.altNone++;
    else if (s.imagesWithAlt < s.imageCount) dist.altPartial++;
    else dist.altFull++;

    if (s.smallestImageWidth !== null && s.smallestImageWidth < 800) lowRes++;

    totalImg += s.imageCount;
    totalDesc += s.descriptionTextLength;
    totalTags += s.tagCount;
    totalVar += s.variantCount;
    totalTitle += s.titleLength;

    if (s.vendor) allVendors.push(s.vendor);
    if (s.productType) allTypes.push(s.productType);
    allTags.push(...s.tags);

    if (s.sourceUpdatedAt && (!lastUpdated || s.sourceUpdatedAt > lastUpdated)) {
      lastUpdated = s.sourceUpdatedAt;
    }
  }

  const n = insights.length;
  const completenessScore = clamp(
    (insights.filter((p) => p.signals.imageCount > 0 && p.signals.descriptionTextLength > 0).length /
      n) *
      100
  );
  const copyScore = clamp(
    insights.reduce((sum, p) => {
      const dl = p.signals.descriptionTextLength;
      const part = dl === 0 ? 0 : dl < 100 ? 25 : dl < 300 ? 60 : dl < 600 ? 85 : 100;
      const b = p.signals.descriptionHasStructure ? 1 : 0.85;
      return sum + part * b;
    }, 0) / n
  );
  const visualScore = clamp(
    insights.reduce((sum, p) => {
      const ic = p.signals.imageCount;
      return sum + (ic >= 4 ? 100 : ic === 3 ? 85 : ic === 2 ? 65 : ic === 1 ? 35 : 0);
    }, 0) / n
  );
  const taggingScore = clamp(
    insights.reduce((sum, p) => {
      const tc = p.signals.tagCount;
      return sum + (tc >= 5 ? 100 : tc >= 3 ? 70 : tc >= 1 ? 40 : 0);
    }, 0) / n
  );

  const scores: AuditScores = {
    catalogCompleteness: Math.round(completenessScore),
    copyQuality: Math.round(copyScore),
    visualQuality: Math.round(visualScore),
    taggingQuality: Math.round(taggingScore),
    overall: Math.round((completenessScore + copyScore + visualScore + taggingScore) / 4)
  };

  return {
    sampled: n,
    avgProductScore: Math.round(insights.reduce((s, p) => s + p.score, 0) / n),
    scores,
    averages: {
      imageCount: +(totalImg / n).toFixed(2),
      descriptionLength: Math.round(totalDesc / n),
      tagCount: +(totalTags / n).toFixed(2),
      variantCount: +(totalVar / n).toFixed(2),
      titleLength: Math.round(totalTitle / n)
    },
    lastProductUpdated: lastUpdated,
    lowResImageCount: lowRes,
    distribution: dist,
    topVendors: tally(allVendors).slice(0, 5),
    topProductTypes: tally(allTypes).slice(0, 5),
    topTags: tally(allTags).slice(0, 10),
    worstProducts: sorted.slice(0, WORST_N),
    bestProducts: sorted.slice(-BEST_N).reverse(),
    latestProducts: pickLatestProducts(insights, LATEST_N),
    /**
     * Full list of analysed products, sorted worst-first, kept on the audit
     * summary so the dashboard can paginate over the entire catalog rather
     * than just the worst-N excerpt.
     */
    allProducts: sorted,
    detectedLanguage: detectLanguage(insights)
  };
}
