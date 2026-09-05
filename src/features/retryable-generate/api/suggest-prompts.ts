'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '@/entities/ai-model';
import { getEffectiveLanguage } from '@/entities/audit';
import { getOrGenerateSuggestions, type PromptSuggestion } from '@/entities/generation-job';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { products, projects, PRODUCT_FIELDS } from '@/shared/db/schema';

const uuid = z.string().uuid();
const field = z.enum(PRODUCT_FIELDS);

export type SuggestPromptsResult =
  | { ok: true; suggestions: PromptSuggestion[]; fromCache: boolean }
  | {
      ok: false;
      error:
        'unauthorized' | 'bad_request' | 'not_found' | 'insufficient_credits' | 'generation_failed';
    };

/**
 * "Proposez-moi des angles" next to the custom-instructions box: a handful of
 * ready-made instructions for this exact product, which the merchant clicks to
 * fill the field. Priced and debited like any other generation; asking again
 * for the same product and field replays the cached round for free.
 */
export async function suggestPromptsAction(
  productId: string,
  forField: string,
  /** "Propose others": retire the round they already saw and pay for a new
   *  one. The plain click still replays the cache for free. */
  force = false
): Promise<SuggestPromptsResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const id = uuid.safeParse(productId);
  const f = field.safeParse(forField);
  if (!id.success || !f.success) return { ok: false, error: 'bad_request' };

  // Ownership is the join: a product exists for a user only through a project
  // they own (same rule as the alt-text actions).
  const [row] = await db
    .select({ product: products, projectId: projects.id })
    .from(products)
    .innerJoin(projects, eq(projects.id, products.projectId))
    .where(and(eq(products.id, id.data), eq(projects.userId, session.user.id)));
  if (!row) return { ok: false, error: 'not_found' };

  const p = row.product;
  const res = await getOrGenerateSuggestions({
    userId: session.user.id,
    projectId: row.projectId,
    productSourceId: p.sourceId ?? p.handle ?? p.id,
    field: f.data,
    languageCode: await getEffectiveLanguage(row.projectId),
    product: {
      title: p.title,
      descriptionText: String(p.descriptionHtml ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags ?? [],
      imageCount: (p.images ?? []).length,
      priceMin: p.priceMin != null ? Number(p.priceMin) : null,
      priceMax: p.priceMax != null ? Number(p.priceMax) : null,
      currency: p.currency
    },
    force
  });

  if (!res.ok) return { ok: false, error: res.reason };
  return { ok: true, suggestions: res.suggestions, fromCache: res.fromCache };
}

/**
 * Persist the product's custom instructions as soon as the merchant leaves the
 * field. They used to be written only as a side effect of a generation, so
 * guidance typed and not immediately used was lost on the next visit.
 */
export async function saveProductInstructionsAction(
  productId: string,
  instructions: string
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const id = uuid.safeParse(productId);
  if (!id.success) return { ok: false };

  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(projects, eq(projects.id, products.projectId))
    .where(and(eq(products.id, id.data), eq(projects.userId, session.user.id)));
  if (!row) return { ok: false };

  const trimmed = instructions.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
  await db
    .update(products)
    .set({ customInstructions: trimmed.length > 0 ? trimmed : null })
    .where(eq(products.id, row.id));
  return { ok: true };
}
