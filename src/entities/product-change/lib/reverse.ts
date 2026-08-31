/**
 * Builds the value of the change that puts a field back where it was
 * (docs/api/IMAGE-OPS.md §3, "Annuler"). Pure: it reads `prior_value` and the
 * value that was applied, and returns a value the normal apply path accepts.
 */
import { z } from 'zod';
import type { ProductChangeField } from '@/shared/db/schema';
import { isImageOpsPayload, type ImageOp, type ImageOpsPayload } from './image-ops';

const priorImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().nullish(),
  sourceImageId: z.string().min(1).nullish(),
  position: z.number().int().nonnegative().optional()
});
const priorImagesSchema = z.array(priorImageSchema);

export type PriorImage = z.infer<typeof priorImageSchema>;

/** `prior_value` is untyped json — read it back through the schema, never a cast. */
export function parsePriorImages(value: unknown): PriorImage[] {
  const parsed = priorImagesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export type ReverseValue =
  { ok: true; value: unknown } | { ok: false; reason: 'no_prior' | 'not_reversible' };

/**
 * Image reverse, ids available: restore the alt text and the order of what is
 * still there, re-attach what the change detached (`append` from the store's
 * own media URL — `remove` never deleted the file, §2). Images the change
 * *added* keep no addressable id at approval time, so they survive the undo;
 * the merchant removes them from the editor (§4). The replace-all path has no
 * such hole — the plain array restores the gallery exactly — so it is preferred
 * whenever the original change was a replace-all.
 */
function reverseImageOps(prior: PriorImage[]): ImageOpsPayload {
  const ops: ImageOp[] = [];
  const order: string[] = [];
  let introduced = 0;
  for (const img of prior) {
    if (img.sourceImageId) {
      ops.push({ op: 'set_alt', target: img.sourceImageId, alt: img.alt ?? '' });
      order.push(img.sourceImageId);
    } else {
      ops.push({ op: 'append', image: { src: img.src, alt: img.alt ?? null } });
      order.push(`new:${introduced++}`);
    }
  }
  ops.push({ op: 'reorder', order });
  return { v: 1, ops };
}

export function buildReverseValue(
  field: ProductChangeField,
  priorValue: unknown,
  appliedValue: unknown
): ReverseValue {
  if (priorValue === null || priorValue === undefined) return { ok: false, reason: 'no_prior' };

  if (field === 'images') {
    const parsed = priorImagesSchema.safeParse(priorValue);
    if (!parsed.success) return { ok: false, reason: 'not_reversible' };
    // Restoring an empty gallery would trip the "cannot remove the last image"
    // rule at creation — refuse here with a reason the UI can explain.
    if (parsed.data.length === 0) return { ok: false, reason: 'not_reversible' };
    const addressable = parsed.data.every((i) => !!i.sourceImageId);
    if (isImageOpsPayload(appliedValue) && addressable) {
      return { ok: true, value: reverseImageOps(parsed.data) };
    }
    return {
      ok: true,
      value: parsed.data.map((i) => ({ src: i.src, alt: i.alt ?? null }))
    };
  }

  if (field === 'tags') {
    const parsed = z.array(z.string()).safeParse(priorValue);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, reason: 'not_reversible' };
  }

  const parsed = z.string().safeParse(priorValue);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: 'not_reversible' };
}
