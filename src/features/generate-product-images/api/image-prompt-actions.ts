'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { products, projects } from '@/shared/db/schema';

const uuid = z.string().uuid();
const MAX_PROMPT = 800;

/**
 * Remember the merchant's own image prompt for this product.
 *
 * A prompt worth writing is worth reusing: the next angle, the next photo, the
 * next visit. Retyping it every time is how a good prompt turns into a lazy one.
 */
export async function saveProductImagePromptAction(
  productId: string,
  prompt: string
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

  const trimmed = prompt.trim().slice(0, MAX_PROMPT);
  await db
    .update(products)
    .set({ customImagePrompt: trimmed.length > 0 ? trimmed : null })
    .where(eq(products.id, row.id));
  return { ok: true };
}
