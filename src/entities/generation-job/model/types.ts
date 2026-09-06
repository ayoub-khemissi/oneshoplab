import type { JobStatus } from '@/shared/db/schema';

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
  /** The alt text written for this image — `costForImage` charged for both,
   *  so it belongs to the job and must travel with it. */
  alt: string | null;
  sourceImageUrl: string | null;
  prompt: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  creditsCost: number;
}

/** Which product field a chat generation targets. `alt` is per-IMAGE (the
 *  image editor and the site-wide "missing alt text" batch), the other three
 *  are per-product — see CopyOptimField for the per-product subset. */
export type ChatOptimField = 'title' | 'description' | 'tags' | 'alt';

/** The per-product copy fields: what the AI panel generates, what the past-
 *  generations strip lists, what "Apply to store" maps to a product field.
 *  `alt` is deliberately outside — it targets one image, not the product. */
export type CopyOptimField = Exclude<ChatOptimField, 'alt'>;

/** Pure-data result of one alt-text generation, shared by the entity, the
 *  server actions that expose it and the client components that render it. */
export interface AltTextResult {
  /** The sentence, already sanitised and capped at ALT_TEXT_MAX_CHARS. */
  alt: string;
  jobId: string;
  creditsConsumed: number;
}
