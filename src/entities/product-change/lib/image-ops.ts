/**
 * The `images` change payload of the v1.1 protocol (docs/api/IMAGE-OPS.md §2).
 *
 * Two shapes are valid for `product_changes.value` when `field = 'images'`:
 *   - a plain array `[{src, alt}]` — the historical "replace everything" shape,
 *     still emitted for connections that never reported a `sourceImageId` (§5);
 *   - `{ v: 1, ops: [...] }` — an ordered operation list.
 *
 * Rules enforced here, at creation time (the store enforces nothing):
 *   - `new:<n>` refers to the n-th image *introduced earlier in the same list*;
 *     forward or out-of-range references are rejected;
 *   - a change may never leave the product with zero images.
 * A target that no longer exists in the store is NOT rejected: OSL's view can
 * be stale, and the executor reports it in `skippedOps` (§2).
 */
import { z } from 'zod';

export const IMAGE_OPS_VERSION = 1;
/** Bounds one change's payload; the editor batches, it does not stream. */
export const MAX_IMAGE_OPS = 60;
const MAX_ID = 255;

const opImageSchema = z.object({
  src: z.string().url().max(2048),
  alt: z.string().max(1024).nullish()
});

const refSchema = z.string().min(1).max(MAX_ID);

/** `set_featured` takes either a brand-new image or an existing target (§4). */
const setFeaturedSchema = z
  .object({
    op: z.literal('set_featured'),
    image: opImageSchema.optional(),
    target: refSchema.optional()
  })
  .refine((o) => (o.image ? !o.target : !!o.target), {
    message: 'set_featured takes exactly one of `image` or `target`'
  });

export const imageOpSchema = z.union([
  setFeaturedSchema,
  z.object({ op: z.literal('append'), image: opImageSchema }),
  z.object({ op: z.literal('replace'), target: refSchema, image: opImageSchema }),
  z.object({ op: z.literal('remove'), target: refSchema }),
  z.object({ op: z.literal('set_alt'), target: refSchema, alt: z.string().max(1024) }),
  z.object({ op: z.literal('reorder'), order: z.array(refSchema).min(1).max(MAX_IMAGE_OPS) })
]);

export const imageOpsPayloadSchema = z.object({
  v: z.literal(IMAGE_OPS_VERSION),
  ops: z.array(imageOpSchema).min(1).max(MAX_IMAGE_OPS)
});

export type ImageOp = z.infer<typeof imageOpSchema>;
export type ImageOpsPayload = z.infer<typeof imageOpsPayloadSchema>;

/** Historical shape: replace the whole gallery with this list. */
export const imageArraySchema = z.array(opImageSchema).max(MAX_IMAGE_OPS);
export type ImageArrayValue = z.infer<typeof imageArraySchema>;

/** Stable identifier of one op inside a change — the `skippedOps` vocabulary. */
export function opRef(index: number, op: ImageOp): string {
  return `${index}:${op.op}`;
}

export function isImageOpsPayload(value: unknown): value is ImageOpsPayload {
  return imageOpsPayloadSchema.safeParse(value).success;
}

export type ImageValueRejection =
  | { code: 'invalid_ops'; issues: string[] }
  | { code: 'unknown_image_ref'; ref: string }
  | { code: 'removes_last_image' };

export type ImageValueCheck =
  | { ok: true; kind: 'ops'; payload: ImageOpsPayload }
  | { ok: true; kind: 'replace_all'; images: ImageArrayValue }
  | { ok: false; rejection: ImageValueRejection };

/** One prior image, as the simulation needs it. */
export interface PriorImageRef {
  src?: string;
  alt?: string | null;
  sourceImageId?: string | null;
}

/** A gallery entry during (and after) the replay. */
export interface SimulatedImage {
  /** Store id when known, `pos:<i>` for an unaddressable prior image, `new:<n>` for a fresh one. */
  ref: string;
  src: string;
  alt: string | null;
}

export interface ImageOpsSimulation {
  images: SimulatedImage[];
  /** Refs of ops the replay could not carry out on OSL's view (targets gone). */
  unresolved: string[];
}

function priorEntries(prior: readonly PriorImageRef[]): SimulatedImage[] {
  return prior.map((img, i) => ({
    ref: img.sourceImageId ?? `pos:${i}`,
    src: img.src ?? '',
    alt: img.alt ?? null
  }));
}

function badNewRef(ref: string, introduced: number): boolean {
  const m = /^new:(\d+)$/.exec(ref);
  // Forward references are a client bug, not a store difference: reject.
  return !!m && Number(m[1]) >= introduced;
}

/**
 * Replays the ops over OSL's view of the gallery. Answers two questions: does
 * the product still have at least one image at the end (the §2 rule), and what
 * would the gallery look like (used to tell "still what we wrote" from "the
 * merchant edited it" when offering "Annuler"). Unknown targets are treated as
 * already-gone — the pessimistic read, which is the safe one for both.
 */
export function simulateImageOps(
  ops: readonly ImageOp[],
  prior: readonly PriorImageRef[]
): { ok: true; simulation: ImageOpsSimulation } | { ok: false; rejection: ImageValueRejection } {
  let images = priorEntries(prior);
  const unresolved: string[] = [];
  let introduced = 0;
  const indexOf = (ref: string) => images.findIndex((i) => i.ref === ref);

  for (const [index, op] of ops.entries()) {
    const ref = opRef(index, op);
    switch (op.op) {
      case 'append': {
        images.push({
          ref: `new:${introduced++}`,
          src: op.image.src,
          alt: op.image.alt ?? null
        });
        break;
      }
      case 'set_featured': {
        const target = op.target;
        if (!target) {
          const image = op.image;
          if (!image) return { ok: false, rejection: { code: 'invalid_ops', issues: [ref] } };
          images.unshift({ ref: `new:${introduced++}`, src: image.src, alt: image.alt ?? null });
          break;
        }
        if (badNewRef(target, introduced))
          return { ok: false, rejection: { code: 'unknown_image_ref', ref: target } };
        const at = indexOf(target);
        if (at < 0) unresolved.push(ref);
        else images.unshift(...images.splice(at, 1));
        break;
      }
      case 'replace': {
        if (badNewRef(op.target, introduced))
          return { ok: false, rejection: { code: 'unknown_image_ref', ref: op.target } };
        // The `new:<n>` counter advances even when the target is gone, so the
        // numbering a client computed offline stays valid whatever the store did.
        const fresh: SimulatedImage = {
          ref: `new:${introduced++}`,
          src: op.image.src,
          alt: op.image.alt ?? null
        };
        const at = indexOf(op.target);
        if (at < 0) unresolved.push(ref);
        else images.splice(at, 1, fresh);
        break;
      }
      case 'remove': {
        if (badNewRef(op.target, introduced))
          return { ok: false, rejection: { code: 'unknown_image_ref', ref: op.target } };
        const at = indexOf(op.target);
        if (at < 0) unresolved.push(ref);
        else images.splice(at, 1);
        break;
      }
      case 'set_alt': {
        if (badNewRef(op.target, introduced))
          return { ok: false, rejection: { code: 'unknown_image_ref', ref: op.target } };
        const at = indexOf(op.target);
        if (at < 0) unresolved.push(ref);
        else images[at] = { ...images[at], alt: op.alt };
        break;
      }
      case 'reorder': {
        for (const r of op.order) {
          if (badNewRef(r, introduced))
            return { ok: false, rejection: { code: 'unknown_image_ref', ref: r } };
        }
        const ranked = new Map(op.order.map((r, i) => [r, i]));
        images = [...images].sort(
          (a, b) =>
            (ranked.get(a.ref) ?? Number.MAX_SAFE_INTEGER) -
            (ranked.get(b.ref) ?? Number.MAX_SAFE_INTEGER)
        );
        break;
      }
    }
  }
  if (images.length === 0) return { ok: false, rejection: { code: 'removes_last_image' } };
  return { ok: true, simulation: { images, unresolved } };
}

/**
 * The gallery a change would produce, in the reduced `{src, alt}` shape the
 * hash contract uses. `null` when the value is not a valid images payload.
 */
export function expectedImagesAfter(
  value: unknown,
  prior: readonly PriorImageRef[]
): Array<{ src: string; alt: string | null }> | null {
  const check = checkImageChangeValue(value, prior);
  if (!check.ok) return null;
  if (check.kind === 'replace_all') {
    return check.images.map((i) => ({ src: i.src, alt: i.alt ?? null }));
  }
  const sim = simulateImageOps(check.payload.ops, prior);
  return sim.ok ? sim.simulation.images.map((i) => ({ src: i.src, alt: i.alt })) : null;
}

/**
 * Validates a `field = 'images'` value against the prior gallery. Returns the
 * parsed shape so callers do not re-parse.
 */
export function checkImageChangeValue(
  value: unknown,
  prior: readonly PriorImageRef[]
): ImageValueCheck {
  if (Array.isArray(value)) {
    const parsed = imageArraySchema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, rejection: { code: 'invalid_ops', issues: issuesOf(parsed.error) } };
    }
    // Replace-all with nothing would leave the store showing a placeholder.
    if (parsed.data.length === 0) {
      return { ok: false, rejection: { code: 'removes_last_image' } };
    }
    return { ok: true, kind: 'replace_all', images: parsed.data };
  }
  const parsed = imageOpsPayloadSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, rejection: { code: 'invalid_ops', issues: issuesOf(parsed.error) } };
  }
  const sim = simulateImageOps(parsed.data.ops, prior);
  if (!sim.ok) return { ok: false, rejection: sim.rejection };
  return { ok: true, kind: 'ops', payload: parsed.data };
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '-'}: ${i.message}`);
}
