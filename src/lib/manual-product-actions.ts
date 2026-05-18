'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { recomputeManualAudit } from '@/lib/audit/from-scratch';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { jobs, products, projects } from '@/lib/db/schema';
import { deleteByKey, keyFromPublicUrl, uploadFromUrl } from '@/lib/storage';

/**
 * CRUD for manual (from-scratch) products. Each mutation:
 *   1. Verifies the caller owns the parent project.
 *   2. Validates with zod (title is the only hard requirement).
 *   3. Persists the row, generating a UUID id and a slug handle.
 *   4. Fires a fire-and-forget recomputeManualAudit so the per-site
 *      overview (scores, distribution, worst products) stays in sync.
 */

const MAX_IMAGES_PER_PRODUCT = 12;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function loadOwnedManualProject(
  userId: string,
  projectId: string
): Promise<{ id: string; source: string } | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
    columns: { id: true, source: true }
  });
  return project ?? null;
}

const ImageSchema = z.object({
  src: z.string().url(),
  alt: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional()
});

const ProductInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(512),
  descriptionHtml: z.string().max(50_000).default(''),
  tags: z.array(z.string().min(1).max(64)).max(50).default([]),
  vendor: z.string().max(255).optional(),
  productType: z.string().max(255).optional(),
  priceMin: z.number().nonnegative().nullable().optional(),
  priceMax: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
  // At least one image is required — manual products live or die by
  // the visual, and the AI rewriter+image-edit pipeline both expect
  // a source image. The client form also gates on this, but defense
  // in depth keeps the DB consistent if a request bypasses the form.
  images: z.array(ImageSchema).min(1).max(MAX_IMAGES_PER_PRODUCT)
});

type ProductInput = z.infer<typeof ProductInputSchema>;

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, 50);
}

function parseImages(raw: string): ProductInput['images'] {
  // The client form posts `images` as a JSON-encoded array stringified
  // into a single hidden input. Decode + validate.
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => ({
        src: String(i.src ?? ''),
        alt: i.alt == null ? null : String(i.alt),
        width: typeof i.width === 'number' ? i.width : null,
        height: typeof i.height === 'number' ? i.height : null
      }))
      .filter((i) => i.src.length > 0)
      .slice(0, MAX_IMAGES_PER_PRODUCT);
  } catch {
    return [];
  }
}

function parseDecimal(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function createManualProductAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projectId = String(formData.get('projectId') ?? '');
  const project = await loadOwnedManualProject(session.user.id, projectId);
  if (!project) redirect('/dashboard');

  const input = ProductInputSchema.safeParse({
    projectId,
    title: String(formData.get('title') ?? ''),
    descriptionHtml: String(formData.get('descriptionHtml') ?? ''),
    tags: parseTags(String(formData.get('tags') ?? '')),
    vendor: String(formData.get('vendor') ?? '') || undefined,
    productType: String(formData.get('productType') ?? '') || undefined,
    priceMin: parseDecimal(formData.get('priceMin')) ?? undefined,
    priceMax: parseDecimal(formData.get('priceMax')) ?? undefined,
    currency: String(formData.get('currency') ?? '') || undefined,
    images: parseImages(String(formData.get('images') ?? ''))
  });
  if (!input.success) {
    // Use a specific error code for the missing-images case so the
    // create page can render a targeted message rather than the
    // generic "invalid input" banner.
    const missingImages = input.error.issues.some(
      (i) => i.path[0] === 'images'
    );
    redirect(
      `/dashboard/sites/${projectId}/products/new?error=${
        missingImages ? 'missing_images' : 'invalid_input'
      }`
    );
  }
  const data = input.data;
  // Capture the CTA the user clicked: "create" stops at the product
  // page; "optimize" hands off to the AI auto-run via query param.
  const intent =
    String(formData.get('intent') ?? 'create') === 'optimize'
      ? 'optimize'
      : 'create';

  const productId = randomUUID();
  await db.insert(products).values({
    id: productId,
    projectId,
    source: 'manual',
    sourceId: productId, // mirror id so existing queries that key off sourceId still work
    handle: slugify(data.title),
    title: data.title,
    descriptionHtml: data.descriptionHtml || '',
    images: data.images.map((i, idx) => ({
      src: i.src,
      alt: i.alt ?? null,
      width: i.width ?? null,
      height: i.height ?? null,
      position: idx
    })),
    tags: data.tags,
    variants: [],
    vendor: data.vendor || null,
    productType: data.productType || null,
    priceMin: data.priceMin != null ? data.priceMin.toFixed(2) : null,
    priceMax:
      data.priceMax != null
        ? data.priceMax.toFixed(2)
        : data.priceMin != null
          ? data.priceMin.toFixed(2)
          : null,
    currency: data.currency || null,
    status: 'active'
  });

  void recomputeManualAudit(projectId).catch((e) =>
    console.error('[manual product] recompute after create failed', e)
  );

  revalidatePath(`/dashboard/sites/${projectId}`);
  redirect(
    `/dashboard/sites/${projectId}/products/${productId}${
      intent === 'optimize' ? '?autoOptimize=1' : ''
    }`
  );
}

export async function updateManualProductAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projectId = String(formData.get('projectId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const project = await loadOwnedManualProject(session.user.id, projectId);
  if (!project) redirect('/dashboard');

  const existing = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, projectId)),
    columns: { id: true, images: true }
  });
  if (!existing) redirect(`/dashboard/sites/${projectId}`);

  const input = ProductInputSchema.safeParse({
    projectId,
    title: String(formData.get('title') ?? ''),
    descriptionHtml: String(formData.get('descriptionHtml') ?? ''),
    tags: parseTags(String(formData.get('tags') ?? '')),
    vendor: String(formData.get('vendor') ?? '') || undefined,
    productType: String(formData.get('productType') ?? '') || undefined,
    priceMin: parseDecimal(formData.get('priceMin')) ?? undefined,
    priceMax: parseDecimal(formData.get('priceMax')) ?? undefined,
    currency: String(formData.get('currency') ?? '') || undefined,
    images: parseImages(String(formData.get('images') ?? ''))
  });
  if (!input.success) {
    const missingImages = input.error.issues.some(
      (i) => i.path[0] === 'images'
    );
    redirect(
      `/dashboard/sites/${projectId}/products/${productId}/edit?error=${
        missingImages ? 'missing_images' : 'invalid_input'
      }`
    );
  }
  const data = input.data;

  // Sweep any R2 image that was removed in this edit. Comparing src
  // sets avoids leaking storage when the user replaces images.
  const oldUrls = new Set((existing.images ?? []).map((i) => i.src));
  const newUrls = new Set(data.images.map((i) => i.src));
  const removed = [...oldUrls].filter((u) => !newUrls.has(u));
  for (const url of removed) {
    const key = keyFromPublicUrl(url);
    if (key) await deleteByKey(key).catch(() => undefined);
  }

  await db
    .update(products)
    .set({
      title: data.title,
      handle: slugify(data.title),
      descriptionHtml: data.descriptionHtml || '',
      images: data.images.map((i, idx) => ({
        src: i.src,
        alt: i.alt ?? null,
        width: i.width ?? null,
        height: i.height ?? null,
        position: idx
      })),
      tags: data.tags,
      vendor: data.vendor || null,
      productType: data.productType || null,
      priceMin: data.priceMin != null ? data.priceMin.toFixed(2) : null,
      priceMax:
        data.priceMax != null
          ? data.priceMax.toFixed(2)
          : data.priceMin != null
            ? data.priceMin.toFixed(2)
            : null,
      currency: data.currency || null
    })
    .where(eq(products.id, productId));

  void recomputeManualAudit(projectId).catch((e) =>
    console.error('[manual product] recompute after update failed', e)
  );

  revalidatePath(`/dashboard/sites/${projectId}`);
  revalidatePath(`/dashboard/sites/${projectId}/products/${productId}`);
  redirect(`/dashboard/sites/${projectId}/products/${productId}`);
}

export async function deleteManualProductAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projectId = String(formData.get('projectId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const project = await loadOwnedManualProject(session.user.id, projectId);
  if (!project) redirect('/dashboard');

  // Reclaim R2 keys for every image on this product before the row
  // is gone — otherwise the cleanup worker would never see them.
  const existing = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, projectId)),
    columns: { images: true }
  });
  if (existing) {
    for (const img of existing.images ?? []) {
      const key = keyFromPublicUrl(img.src);
      if (key) await deleteByKey(key).catch(() => undefined);
    }
  }

  await db.delete(products).where(eq(products.id, productId));

  void recomputeManualAudit(projectId).catch((e) =>
    console.error('[manual product] recompute after delete failed', e)
  );

  revalidatePath(`/dashboard/sites/${projectId}`);
  redirect(`/dashboard/sites/${projectId}`);
}

/**
 * Replace a manual product's content (title, description, tags, images)
 * with the most recent completed AI generations. Only operates on
 * `source: 'manual'` projects — for scraped projects the "source of
 * truth" lives upstream so this would be lossy.
 *
 * Fields are replaced à la carte: if the merchant never generated a
 * title but did generate a description, only the description is
 * touched. The button on the page hides itself when nothing has been
 * generated yet, so the no-op case shouldn't normally hit.
 *
 * Image handling deserves a note. AI image jobs persist URLs under
 * R2's "images/products/..." namespace, which the r2-cleanup worker
 * walks for plan-based expiry (30-90d). If we just pointed
 * `products.images` at those URLs the product would silently break
 * the day cleanup ran. Instead we COPY each AI image into the
 * user-uploads namespace ("products/{projectId}/...") via
 * uploadFromUrl — same bytes, new key, exempt from cleanup (the
 * worker only walks job-derived keys). The original AI job stays
 * intact and can still expire on its normal schedule.
 */
function extOfUrl(url: string): string {
  const match = url.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

async function findLatestChatOutput(
  projectId: string,
  productSourceId: string,
  kind: 'kie_title' | 'kie_description' | 'kie_tags'
): Promise<string | string[] | null> {
  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, kind),
      eq(jobs.status, 'completed')
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 20
  });
  for (const j of candidates) {
    const input = j.inputPayload as { productSourceId?: string } | null;
    if (input?.productSourceId !== productSourceId) continue;
    const r = j.result as { output?: string | string[] } | null;
    if (r?.output != null) return r.output;
  }
  return null;
}

async function findLatestImageJobs(
  projectId: string,
  productSourceId: string
): Promise<string[]> {
  // Pull every completed non-hidden image job that matches this
  // product. The merchant curates the visible set themselves via the
  // hide action on the AI grid (POST /api/products/image-jobs ...
  // hiddenAt=now), so anything still showing on the right panel is
  // explicitly endorsed — Apply copies it all, capped to the same
  // MAX_IMAGES_PER_PRODUCT ceiling the manual form enforces (12).
  // Newest first so the most recent generations win if the user has
  // re-rolled past the cap.
  const candidates = await db.query.jobs.findMany({
    where: and(
      eq(jobs.projectId, projectId),
      eq(jobs.kind, 'kie_image_edit'),
      eq(jobs.status, 'completed'),
      isNull(jobs.hiddenAt)
    ),
    orderBy: [desc(jobs.createdAt)],
    limit: 60
  });
  const urls: string[] = [];
  for (const j of candidates) {
    const input = j.inputPayload as { productSourceId?: string } | null;
    if (input?.productSourceId !== productSourceId) continue;
    const r = j.result as { persistedUrls?: string[] } | null;
    const u = r?.persistedUrls?.[0];
    if (u) urls.push(u);
    if (urls.length >= MAX_IMAGES_PER_PRODUCT) break;
  }
  return urls;
}

export async function applyAiToManualProductAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projectId = String(formData.get('projectId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const project = await loadOwnedManualProject(session.user.id, projectId);
  if (!project) redirect('/dashboard');
  if (project.source !== 'manual') {
    redirect(`/dashboard/sites/${projectId}/products/${productId}`);
  }

  const productRow = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.projectId, projectId))
  });
  if (!productRow) redirect(`/dashboard/sites/${projectId}`);
  if (!productRow.sourceId) {
    // Manual products mirror their UUID into sourceId — if this is
    // missing the product can't be matched against AI jobs.
    redirect(`/dashboard/sites/${projectId}/products/${productId}`);
  }

  const [aiTitle, aiDescription, aiTags, aiImageUrls] = await Promise.all([
    findLatestChatOutput(projectId, productRow.sourceId, 'kie_title'),
    findLatestChatOutput(projectId, productRow.sourceId, 'kie_description'),
    findLatestChatOutput(projectId, productRow.sourceId, 'kie_tags'),
    findLatestImageJobs(projectId, productRow.sourceId)
  ]);

  const updates: Partial<typeof products.$inferInsert> = {};

  if (typeof aiTitle === 'string' && aiTitle.trim().length > 0) {
    updates.title = aiTitle.trim();
    updates.handle = slugify(aiTitle);
  }
  if (typeof aiDescription === 'string' && aiDescription.trim().length > 0) {
    updates.descriptionHtml = aiDescription;
  }
  if (Array.isArray(aiTags) && aiTags.length > 0) {
    updates.tags = aiTags.filter((t) => typeof t === 'string' && t.length > 0);
  }

  let newImages: Array<{
    src: string;
    alt: string | null;
    width: number | null;
    height: number | null;
    position: number;
  }> | null = null;
  if (aiImageUrls.length > 0) {
    // Copy each AI URL into the permanent user-uploads namespace.
    // Failures are skipped (best-effort) — at least one copied image
    // is required to swap the user's existing set; if all copies
    // fail we leave the original images in place.
    const copied = await Promise.all(
      aiImageUrls.map(async (url, idx) => {
        try {
          const key = `products/${projectId}/${randomUUID()}${extOfUrl(url)}`;
          const result = await uploadFromUrl(url, key);
          return {
            src: result.publicUrl,
            alt: (updates.title as string | undefined) ?? productRow.title ?? null,
            width: null,
            height: null,
            position: idx
          };
        } catch (e) {
          console.error('[apply-ai] image copy failed', { url, error: (e as Error).message });
          return null;
        }
      })
    );
    const valid = copied.filter((c): c is NonNullable<typeof c> => c !== null);
    if (valid.length > 0) {
      newImages = valid;
      updates.images = valid;
    }
  }

  if (Object.keys(updates).length === 0) {
    redirect(
      `/dashboard/sites/${projectId}/products/${productId}?error=no_ai_to_apply`
    );
  }

  // Sweep the old user-uploaded images IF we're replacing them, so
  // R2 doesn't leak orphans (the cleanup worker only walks job-side
  // keys, not products.images).
  if (newImages !== null) {
    for (const img of (productRow.images ?? []) as Array<{ src: string }>) {
      const key = keyFromPublicUrl(img.src);
      if (key) await deleteByKey(key).catch(() => undefined);
    }
  }

  await db.update(products).set(updates).where(eq(products.id, productId));

  void recomputeManualAudit(projectId).catch((e) =>
    console.error('[manual product] recompute after apply-ai failed', e)
  );

  revalidatePath(`/dashboard/sites/${projectId}`);
  revalidatePath(`/dashboard/sites/${projectId}/products/${productId}`);
  redirect(
    `/dashboard/sites/${projectId}/products/${productId}?applied=1`
  );
}
