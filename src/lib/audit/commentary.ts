/**
 * Tier classification for static-analysis commentary blocks.
 * Pure mapping from numeric scores → predefined message tier; the actual
 * copy lives in the i18n message files under `Report.commentary.*`.
 *
 * Two granularities:
 *   - section tiers (overall, axes, stats) drive the section-level border
 *     colour of each commentary paragraph
 *   - per-axis / per-stat tiers drive the SENTENCE picked for each sub-block
 *     so the paragraph reads naturally (one sentence per card)
 */

export type CommentaryTier = 'poor' | 'mid' | 'good';

export interface ScoresLike {
  overall: number;
  catalogCompleteness: number;
  copyQuality: number;
  visualQuality: number;
  taggingQuality: number;
}

export interface CommentaryTiers {
  overall: CommentaryTier;
  axes: CommentaryTier;
  stats: CommentaryTier;
}

export interface AxesValueTiers {
  catalog: CommentaryTier;
  copy: CommentaryTier;
  visual: CommentaryTier;
  tagging: CommentaryTier;
}

export interface StatsValueTiers {
  avgScore: CommentaryTier;
  avgImages: CommentaryTier;
  avgDescLength: CommentaryTier;
  avgTags: CommentaryTier;
}

export function tierFromScore(n: number): CommentaryTier {
  if (n >= 75) return 'good';
  if (n >= 50) return 'mid';
  return 'poor';
}

/** ≥3 images per product is the typical e-commerce baseline. */
export function tierFromImages(avg: number): CommentaryTier {
  if (avg >= 3) return 'good';
  if (avg >= 2) return 'mid';
  return 'poor';
}

/** Description length sweet spot ~200-400 chars. */
export function tierFromDescLength(chars: number): CommentaryTier {
  if (chars >= 300) return 'good';
  if (chars >= 100) return 'mid';
  return 'poor';
}

/** Tag coverage: <3 hurts discovery, ≥7 is solid. */
export function tierFromTags(avg: number): CommentaryTier {
  if (avg >= 7) return 'good';
  if (avg >= 3) return 'mid';
  return 'poor';
}

export function commentaryTiers(scores: ScoresLike): CommentaryTiers {
  const minAxis = Math.min(
    scores.catalogCompleteness,
    scores.copyQuality,
    scores.visualQuality,
    scores.taggingQuality
  );
  return {
    overall: tierFromScore(scores.overall),
    axes: tierFromScore(minAxis),
    stats: tierFromScore(scores.overall)
  };
}

export function axesValueTiers(scores: ScoresLike): AxesValueTiers {
  return {
    catalog: tierFromScore(scores.catalogCompleteness),
    copy: tierFromScore(scores.copyQuality),
    visual: tierFromScore(scores.visualQuality),
    tagging: tierFromScore(scores.taggingQuality)
  };
}

export function statsValueTiers(input: {
  avgScore: number;
  avgImages: number;
  avgDescLength: number;
  avgTags: number;
}): StatsValueTiers {
  return {
    avgScore: tierFromScore(input.avgScore),
    avgImages: tierFromImages(input.avgImages),
    avgDescLength: tierFromDescLength(input.avgDescLength),
    avgTags: tierFromTags(input.avgTags)
  };
}
