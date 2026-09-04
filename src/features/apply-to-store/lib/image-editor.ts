/**
 * Pure state of the product image editor (docs/api/IMAGE-OPS.md §4): the
 * merchant's clicks become an ordered op list, and the entity's own
 * `simulateImageOps` says what the gallery would look like. Nothing here
 * touches React or the db, so the assembly rules are unit-tested directly.
 *
 * Two invariants the UI relies on:
 *   - `reorder` is always the LAST op (it ranks refs, so it must see every
 *     append/remove that came before);
 *   - clicking the same action twice on the same photo replaces the queued op
 *     instead of stacking a second one — the merchant reads the queue as a
 *     list of decisions, not of clicks.
 */
import {
  simulateImageOps,
  type ImageOp,
  type ImageValueRejection,
  type PriorImageRef
} from '@/entities/product-change/client';
import type { ConnectionCapabilities, ImageOpVerb } from '@/shared/db/schema';

export interface QueuedOp {
  /** Stable across renders so the panel's "remove this one" hits the right row. */
  id: string;
  op: ImageOp;
}

export interface EditorQueue {
  ops: QueuedOp[];
  /** Desired final order, refs of the simulated gallery. `null` = untouched. */
  order: string[] | null;
}

export const EMPTY_QUEUE: EditorQueue = { ops: [], order: null };

/** One tile of the grid, before the queue is replayed. */
export interface EditorImage {
  /** React key: the store id for a photo, `gen:<jobId>` for a generation. */
  key: string;
  kind: 'store' | 'generated';
  src: string;
  alt: string | null;
  /** Opaque store id — null when the store never reported one (§1). */
  sourceImageId: string | null;
  /** 1-based rank in the store gallery / in the generated strip. */
  index: number;
}

/**
 * Ops the merchant may be offered on one tile. Every flag is a capability the
 * connection declared: a button that would silently do nothing is never shown
 * (§7).
 */
export interface TileActions {
  setFeatured: boolean;
  append: boolean;
  replace: boolean;
  remove: boolean;
  setAlt: boolean;
  move: boolean;
}

export interface TileContext {
  capabilities: ConnectionCapabilities;
  /** Photos the product would keep once the queue is applied. */
  previewCount: number;
  /** Generations available as a source for append / replace. */
  generatedCount: number;
  /** False as soon as one store photo has no id: `reorder` sends a full order,
   *  and a partial one would silently drop that photo to the end. */
  everyStoreImageAddressable: boolean;
  /** Already on the product (either a store photo or a queued addition). */
  inGallery: boolean;
}

const NO_ACTIONS: TileActions = {
  setFeatured: false,
  append: false,
  replace: false,
  remove: false,
  setAlt: false,
  move: false
};

export function tileActions(image: EditorImage, ctx: TileContext): TileActions {
  const caps = ctx.capabilities;
  if (!caps.stableImageIds) return NO_ACTIONS;
  if (image.kind === 'store' && !image.sourceImageId) return NO_ACTIONS;
  const can = (verb: ImageOpVerb) => caps.imageOps.includes(verb);
  const isStore = image.kind === 'store';
  const room = ctx.previewCount < caps.maxImages;
  return {
    setFeatured: can('set_featured') && (isStore || ctx.inGallery || room),
    append: !isStore && !ctx.inGallery && can('append') && room,
    replace: isStore && can('replace') && ctx.generatedCount > 0,
    // The store would show a placeholder with an empty gallery (§2).
    remove: isStore && can('remove') && ctx.previewCount > 1,
    // A generation carries its alt in the payload (set at creation time), so
    // editing it needs no `set_alt` — only a verb that puts it on the product.
    setAlt: isStore
      ? can('set_alt') && caps.altEditable
      : can('append') || can('replace') || can('set_featured'),
    move: ctx.inGallery && can('reorder') && ctx.everyStoreImageAddressable
  };
}

/** True when the merchant can do anything at all image by image. */
export function hasPerImageActions(caps: ConnectionCapabilities): boolean {
  return caps.stableImageIds && caps.imageOps.length > 0;
}

// ============================================================================
// Queue assembly
// ============================================================================

/**
 * Slots a queued decision occupies — a new op sharing one replaces it. Two
 * rules: at most one "main photo" decision, and at most one destination per
 * generated visual (otherwise a second click would add the same image twice).
 */
function slotsOf(op: ImageOp): string[] {
  switch (op.op) {
    case 'set_featured':
      return op.image ? ['featured', `visual:${op.image.src}`] : ['featured'];
    case 'append':
      return [`visual:${op.image.src}`];
    case 'replace':
      return [`replace:${op.target}`, `visual:${op.image.src}`];
    case 'remove':
      return [`remove:${op.target}`];
    case 'set_alt':
      return [`set_alt:${op.target}`];
    case 'reorder':
      return ['reorder'];
  }
}

export function pushOp(queue: EditorQueue, op: ImageOp, id: string): EditorQueue {
  const slots = new Set(slotsOf(op));
  return {
    ...queue,
    ops: [...queue.ops.filter((q) => !slotsOf(q.op).some((s) => slots.has(s))), { id, op }]
  };
}

export function removeQueuedOp(queue: EditorQueue, id: string): EditorQueue {
  return { ...queue, ops: queue.ops.filter((q) => q.id !== id) };
}

/**
 * An alt edited on a generation must follow it into every op that carries it:
 * the merchant typed the text once, on the tile.
 */
export function withAltForSrc(queue: EditorQueue, src: string, alt: string | null): EditorQueue {
  return { ...queue, ops: queue.ops.map((q) => ({ ...q, op: retagAlt(q.op, src, alt) })) };
}

function retagAlt(op: ImageOp, src: string, alt: string | null): ImageOp {
  if (op.op === 'append' && op.image.src === src) return { ...op, image: { ...op.image, alt } };
  if (op.op === 'replace' && op.image.src === src) return { ...op, image: { ...op.image, alt } };
  if (op.op === 'set_featured' && op.image?.src === src)
    return { ...op, image: { ...op.image, alt } };
  return op;
}

/**
 * Keeps the merchant's order, drops refs that the queue removed, and appends
 * whatever appeared since (a freshly queued image lands at the end rather than
 * silently jumping to the front).
 */
export function normalizeOrder(desired: readonly string[], present: readonly string[]): string[] {
  const kept = desired.filter((ref) => present.includes(ref));
  return [...kept, ...present.filter((ref) => !kept.includes(ref))];
}

export interface EditorPreview {
  /** The payload as it would be sent — `reorder` last. */
  ops: ImageOp[];
  /** Resulting gallery, in order. Empty when the queue cannot be replayed. */
  images: Array<{ ref: string; src: string; alt: string | null }>;
  /** Refs the replay could not resolve (photo gone from OSL's view). */
  unresolved: string[];
  /** The queue is not applicable as it stands (e.g. it empties the gallery). */
  invalid: boolean;
  /** Why, so the merchant is told the actual rule they hit rather than a
   *  generic "these can't be applied together" that sends them hunting for a
   *  conflict between two ops when the problem is a single one. */
  invalidReason: ImageValueRejection['code'] | null;
}

/** Replays the queue over the store gallery — the entity owns the simulation. */
export function previewQueue(queue: EditorQueue, prior: readonly PriorImageRef[]): EditorPreview {
  const base = queue.ops.map((q) => q.op);
  const first = simulateImageOps(base, prior);
  if (!first.ok)
    return {
      ops: base,
      images: [],
      unresolved: [],
      invalid: true,
      invalidReason: first.rejection.code
    };
  if (!queue.order) {
    return {
      ops: base,
      images: first.simulation.images,
      unresolved: first.simulation.unresolved,
      invalid: false,
      invalidReason: null
    };
  }
  const order = normalizeOrder(
    queue.order,
    first.simulation.images.map((i) => i.ref)
  );
  const ops: ImageOp[] = [...base, { op: 'reorder', order }];
  const second = simulateImageOps(ops, prior);
  if (!second.ok)
    return { ops, images: [], unresolved: [], invalid: true, invalidReason: second.rejection.code };
  return {
    ops,
    images: second.simulation.images,
    unresolved: second.simulation.unresolved,
    invalid: false,
    invalidReason: null
  };
}

/** Moves one ref by one slot inside the previewed gallery. */
export function moveRef(refs: readonly string[], ref: string, delta: -1 | 1): string[] {
  const from = refs.indexOf(ref);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= refs.length) return [...refs];
  const next = [...refs];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// ============================================================================
// Plain-words descriptions ("Définir la photo 3 comme principale")
// ============================================================================

/** Turns a ref or a src into the label shown on the tile ("Photo 3"). */
export interface RefNamer {
  byRef(ref: string): string;
  bySrc(src: string): string;
}

export interface OpDescription {
  /** Key under `ProductImages.*` — the component translates it. */
  key: string;
  values: Record<string, string>;
}

export function describeOp(op: ImageOp, name: RefNamer): OpDescription {
  switch (op.op) {
    case 'set_featured':
      return op.target
        ? { key: 'opSetFeatured', values: { photo: name.byRef(op.target) } }
        : { key: 'opSetFeaturedNew', values: { photo: name.bySrc(op.image?.src ?? '') } };
    case 'append':
      return { key: 'opAppend', values: { photo: name.bySrc(op.image.src) } };
    case 'replace':
      return {
        key: 'opReplace',
        values: { photo: name.byRef(op.target), other: name.bySrc(op.image.src) }
      };
    case 'remove':
      return { key: 'opRemove', values: { photo: name.byRef(op.target) } };
    case 'set_alt':
      return { key: 'opSetAlt', values: { photo: name.byRef(op.target) } };
    case 'reorder':
      return { key: 'opReorder', values: {} };
  }
}
