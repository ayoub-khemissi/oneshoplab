import type { JobStatus } from '@/lib/db/schema';

/**
 * Pure-data shape returned by the image-jobs API and consumed by the
 * client grid. Lives in its own module so importing the type from a
 * client component doesn't pull in the server-only Drizzle / mysql2
 * code that the query helper depends on.
 */
export interface ImageJobRow {
  id: string;
  status: JobStatus;
  kieTaskId: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  prompt: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  creditsCost: number;
}

/** Hard cap on visible (non-hidden) image jobs per product. */
export const MAX_IMAGES_PER_PRODUCT = 6;
