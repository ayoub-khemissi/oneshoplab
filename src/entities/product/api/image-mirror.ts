import { randomUUID } from 'node:crypto';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '@/shared/db';
import { imageMirrorQueue, products } from '@/shared/db/schema';
import { SafeFetchError, fetchRemoteImage } from '@/shared/lib/safe-fetch';
import { isOurStorageUrl, isR2Configured, uploadBuffer } from '@/shared/storage';

/**
 * External product images → our R2 bucket.
 *
 * A CSV import creates the product at once with the merchant's links, then
 * queues each link here. The worker copies the file onto our storage and
 * rewrites `products.images[].src`. Until that happens (or if it never does)
 * the product keeps its external link: this pass only ever replaces a link
 * with a working copy, it never removes one.
 *
 * Keys use the `products/<projectId>/<uuid>.<ext>` prefix, identical to the
 * manual upload route, so both live and die by the same lifecycle rules.
 */

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 10;
/** A claimed-but-unfinished row is left alone this long before another tick
 *  may pick it up again. Also the back-off between two attempts. Comfortably
 *  above the 8 s fetch timeout plus the R2 upload. */
const DEFAULT_RETRY_DELAY_MS = 60_000;
/** Column width of image_mirror_queue.source_url. */
const MAX_SOURCE_URL_LENGTH = 2048;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
};

/**
 * Queue one pending row per distinct URL, skipping links that already point
 * at our storage and links that would not fit the column. Returns the number
 * of rows inserted.
 */
export async function enqueueImageMirrors(
  projectId: string,
  productId: string,
  urls: string[]
): Promise<number> {
  const distinct = [...new Set(urls.map((u) => u.trim()))].filter(
    (u) => u.length > 0 && u.length <= MAX_SOURCE_URL_LENGTH && !isOurStorageUrl(u)
  );
  if (distinct.length === 0) return 0;
  await db
    .insert(imageMirrorQueue)
    .values(distinct.map((sourceUrl) => ({ id: randomUUID(), projectId, productId, sourceUrl })));
  return distinct.length;
}

export interface MirrorQueuedImagesOptions {
  batch?: number;
  fetcher?: typeof fetchRemoteImage;
  /** Minimum age of a claimed row before it is eligible again (tests pass 0). */
  retryDelayMs?: number;
}

/**
 * One worker pass: claim up to `batch` of the oldest eligible pending rows
 * and mirror them. Returns the number of rows processed (successes and
 * failures alike); rows another tick claimed first are not counted.
 *
 * Claiming is a conditional UPDATE on (status = 'pending', attempts = <as
 * read>) that bumps `attempts`: whichever concurrent tick wins the row-level
 * write owns the row, the other sees 0 affected rows and moves on. A claimed
 * row stays 'pending' but its fresh `updatedAt` hides it from other ticks
 * for `retryDelayMs`, so a fetch still in flight is never started twice.
 */
export async function mirrorQueuedImages(opts: MirrorQueuedImagesOptions = {}): Promise<number> {
  if (!isR2Configured()) return 0;
  const batch = opts.batch ?? DEFAULT_BATCH;
  const fetcher = opts.fetcher ?? fetchRemoteImage;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const retrySeconds = Math.max(0, Math.floor(retryDelayMs / 1000));

  const candidates = await db
    .select({
      id: imageMirrorQueue.id,
      projectId: imageMirrorQueue.projectId,
      productId: imageMirrorQueue.productId,
      sourceUrl: imageMirrorQueue.sourceUrl,
      attempts: imageMirrorQueue.attempts
    })
    .from(imageMirrorQueue)
    .where(
      and(
        eq(imageMirrorQueue.status, 'pending'),
        lt(imageMirrorQueue.attempts, MAX_ATTEMPTS),
        or(
          eq(imageMirrorQueue.attempts, 0),
          sql`${imageMirrorQueue.updatedAt} <= (NOW() - INTERVAL ${sql.raw(String(retrySeconds))} SECOND)`
        )
      )
    )
    .orderBy(asc(imageMirrorQueue.createdAt), asc(imageMirrorQueue.id))
    .limit(batch);
  if (candidates.length === 0) return 0;

  const results = await Promise.all(
    candidates.map(async (row) => {
      const claimed = await claim(row.id, row.attempts);
      if (!claimed) return 0;
      await mirrorOne({ ...row, attempts: row.attempts + 1 }, fetcher);
      return 1;
    })
  );
  return results.reduce<number>((a, b) => a + b, 0);
}

type QueueRow = {
  id: string;
  projectId: string;
  productId: string;
  sourceUrl: string;
  attempts: number;
};

async function claim(id: string, seenAttempts: number): Promise<boolean> {
  const [res] = await db
    .update(imageMirrorQueue)
    .set({ attempts: seenAttempts + 1, updatedAt: sql`NOW()` })
    .where(
      and(
        eq(imageMirrorQueue.id, id),
        eq(imageMirrorQueue.status, 'pending'),
        eq(imageMirrorQueue.attempts, seenAttempts)
      )
    );
  return res.affectedRows === 1;
}

/** `row.attempts` is the count including the attempt being made. */
async function mirrorOne(row: QueueRow, fetcher: typeof fetchRemoteImage): Promise<void> {
  try {
    const { buffer, contentType } = await fetcher(row.sourceUrl);
    const ext = EXT_BY_TYPE[contentType] ?? 'bin';
    const key = `products/${row.projectId}/${randomUUID()}.${ext}`;
    const uploaded = await uploadBuffer(buffer, key, contentType);
    await rewriteProductImages(row.productId, row.sourceUrl, uploaded.publicUrl);
    await db
      .update(imageMirrorQueue)
      .set({ status: 'done', error: null })
      .where(eq(imageMirrorQueue.id, row.id));
  } catch (e) {
    const message = describeError(e).slice(0, 500);
    await db
      .update(imageMirrorQueue)
      .set({ error: message, status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' })
      .where(eq(imageMirrorQueue.id, row.id));
  }
}

/**
 * Replace every image whose `src` is exactly `sourceUrl` with the mirrored
 * URL, keeping alt/width/height/position and any other field. Runs under a
 * row lock: two rows of the same product may be mirrored by two ticks at
 * once, and a plain read-modify-write would lose one of the two rewrites.
 */
async function rewriteProductImages(
  productId: string,
  sourceUrl: string,
  publicUrl: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [product] = await tx
      .select({ images: products.images })
      .from(products)
      .where(eq(products.id, productId))
      .for('update');
    if (!product) throw new Error(`Product ${productId} no longer exists`);
    const images = product.images ?? [];
    let touched = false;
    const next = images.map((img) => {
      if (img.src !== sourceUrl) return img;
      touched = true;
      return { ...img, src: publicUrl };
    });
    if (touched) await tx.update(products).set({ images: next }).where(eq(products.id, productId));
  });
}

function describeError(e: unknown): string {
  if (e instanceof SafeFetchError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}
