import type { ImageOp, ImageOpsPayload } from './image-ops';

/**
 * Drops the `append` ops whose image is already on its way to the store (a
 * pending change) or already in it (an applied one), renumbering the
 * `new:<n>` refs that follow.
 *
 * Two paths queue the same generated photo: "send this generation" on its
 * tile, and the photo editor's "Add … to the gallery". Each was right on its
 * own; together they appended the picture twice (found 2026-09-27, Shopify
 * stored `x.png` and `x_<uuid>.png`). Only plain appends are dropped:
 * `replace` and `set_featured` carry a placement the merchant chose.
 */
export function withoutTakenAppends(
  payload: ImageOpsPayload,
  taken: ReadonlySet<string>
): { payload: ImageOpsPayload | null; dropped: Array<{ src: string; alt: string | null }> } {
  const dropped: Array<{ src: string; alt: string | null }> = [];
  // Old `new:<n>` index → new index, or null when its image was dropped.
  const renumber: Array<number | null> = [];
  let introduced = 0;
  const introduce = (keep: boolean) => renumber.push(keep ? introduced++ : null);
  const remap = (ref: string): string | null => {
    const m = /^new:(\d+)$/.exec(ref);
    if (!m) return ref;
    const to = renumber[Number(m[1])];
    return to === null || to === undefined ? null : `new:${to}`;
  };

  const ops: ImageOp[] = [];
  for (const op of payload.ops) {
    switch (op.op) {
      case 'append': {
        if (taken.has(op.image.src)) {
          dropped.push({ src: op.image.src, alt: op.image.alt ?? null });
          introduce(false);
        } else {
          introduce(true);
          ops.push(op);
        }
        break;
      }
      case 'set_featured': {
        if (!op.target) {
          introduce(true);
          ops.push(op);
          break;
        }
        const target = remap(op.target);
        if (target) ops.push({ ...op, target });
        break;
      }
      case 'replace': {
        const target = remap(op.target);
        introduce(target !== null);
        if (target) ops.push({ ...op, target });
        break;
      }
      case 'remove':
      case 'set_alt': {
        const target = remap(op.target);
        if (target) ops.push({ ...op, target });
        break;
      }
      case 'reorder': {
        const order = op.order.map(remap).filter((r): r is string => r !== null);
        if (order.length) ops.push({ ...op, order });
        break;
      }
    }
  }
  return { payload: ops.length ? { ...payload, ops } : null, dropped };
}
