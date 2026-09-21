import type { ImageJobRow } from '@/entities/generation-job';

/** Hard cap on visible (non-hidden) GENERATIONS per product. Cut-outs
 *  (transparent versions of an existing image) sit outside it: they are
 *  limited to one per source instead. */
export const MAX_IMAGES_PER_PRODUCT = 6;

/** How many of the visible tiles count toward the cap. */
export function generationCount(jobs: ReadonlyArray<Pick<ImageJobRow, 'derived'>>): number {
  return jobs.filter((j) => j.derived !== 'remove_bg').length;
}
