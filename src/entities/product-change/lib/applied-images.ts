import { isImageOpsPayload } from './image-ops';

/**
 * The generated visuals a store has already taken.
 *
 * Once an applied change has put a photo on the product, the store holds its
 * own copy under its own URL — so the same picture would sit twice in the
 * editor: once as a store photo, once as the generation it came from. The
 * merchant reads that as a duplicate, and it is: the generation's job is done.
 *
 * Reads the ops of the changes rather than the store's gallery, because the
 * store re-hosts what it accepts and its URL tells us nothing about where the
 * image came from.
 */
export function appliedGeneratedSources(
  changes: ReadonlyArray<{ field: string; status: string; value: unknown }>
): Set<string> {
  const taken = new Set<string>();
  for (const change of changes) {
    if (change.field !== 'images' || change.status !== 'applied') continue;
    // Replace-all path: the value is the gallery itself.
    if (Array.isArray(change.value)) {
      for (const image of change.value) {
        const src = (image as { src?: unknown }).src;
        if (typeof src === 'string') taken.add(src);
      }
      continue;
    }
    if (!isImageOpsPayload(change.value)) continue;
    for (const op of change.value.ops) {
      if (
        (op.op === 'append' || op.op === 'replace' || op.op === 'set_featured') &&
        op.image?.src
      ) {
        taken.add(op.image.src);
      }
    }
  }
  return taken;
}
