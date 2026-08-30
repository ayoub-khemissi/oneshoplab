/**
 * Body of `POST /api/v1/products/sync` (docs/api/INTEGRATION-API.md §3).
 * Caps are the spec's: 200 products, 30 images, 50 tags × 64 chars,
 * title 512, descriptionHtml 64 KiB. Unknown fields are ignored (zod
 * strips them); a duplicate `sourceId` is reported with its index.
 */
import { z } from 'zod';

export const SYNC_BATCH_SIZE = 200;
export const MAX_IMAGES_PER_PRODUCT = 30;
export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;
export const MAX_TITLE_LENGTH = 512;
export const MAX_DESCRIPTION_BYTES = 64 * 1024;

const nullableStr = (max: number) => z.string().max(max).nullish();

export const syncImageSchema = z.object({
  src: z.string().url().max(2048),
  alt: nullableStr(1024),
  width: z.number().int().nonnegative().nullish(),
  height: z.number().int().nonnegative().nullish(),
  position: z.number().int().nonnegative().optional()
});

export const syncVariantSchema = z.object({
  id: z.string().min(1).max(255),
  sourceVariantId: nullableStr(255),
  title: nullableStr(512),
  sku: nullableStr(255),
  price: z.number().finite(),
  available: z.boolean(),
  options: z.record(z.string().max(255), z.string().max(1024)).optional()
});

export const syncProductSchema = z.object({
  sourceId: z.string().min(1).max(255),
  sourceUrl: nullableStr(1024),
  handle: nullableStr(255),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  descriptionHtml: z
    .string()
    .refine((s) => Buffer.byteLength(s) <= MAX_DESCRIPTION_BYTES, {
      message: `descriptionHtml exceeds ${MAX_DESCRIPTION_BYTES} bytes`
    })
    .optional(),
  images: z.array(syncImageSchema).max(MAX_IMAGES_PER_PRODUCT).optional(),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
  variants: z.array(syncVariantSchema).max(500).optional(),
  vendor: nullableStr(255),
  productType: nullableStr(255),
  priceMin: z.number().finite().nullish(),
  priceMax: z.number().finite().nullish(),
  currency: nullableStr(8),
  sku: nullableStr(255),
  sourceUpdatedAt: z.string().datetime({ offset: true }).nullish()
});

export const syncBodySchema = z
  .object({
    mode: z.enum(['partial', 'full']),
    session: z.string().min(1).max(64).optional(),
    final: z.boolean().optional(),
    products: z.array(syncProductSchema).max(SYNC_BATCH_SIZE)
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.products.forEach((p, index) => {
      if (seen.has(p.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['products', index, 'sourceId'],
          message: `duplicate sourceId "${p.sourceId}" (index ${index})`,
          params: { index, sourceId: p.sourceId }
        });
      }
      seen.add(p.sourceId);
    });
  });

export type SyncBody = z.infer<typeof syncBodySchema>;
export type SyncProductInput = z.infer<typeof syncProductSchema>;

export const ackBodySchema = z.object({
  status: z.enum(['applied', 'failed', 'skipped']),
  error: z.string().max(1000).optional(),
  storeUpdatedAt: z.string().datetime({ offset: true }).optional(),
  storeValueHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'sha256 hex expected')
    .optional()
});
export type AckBody = z.infer<typeof ackBodySchema>;

export const changesQuerySchema = z.object({
  since: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'cursor must be a change id')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
