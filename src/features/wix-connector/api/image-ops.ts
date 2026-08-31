/**
 * Wix's `ImageOpsExecutor` (docs/api/IMAGE-OPS.md §7). Wix Stores Catalog v1
 * exposes exactly two media verbs — add (`POST …/media`) and remove
 * (`POST …/media/delete`) — so this executor runs `append`, `remove` and
 * `replace` (remove + add) and reports everything else in `skippedOps`:
 * the API has no ordering call (`reorder`, `set_featured`) and no per-item
 * update (`set_alt`). Declaring less than the store can do would only cost a
 * button; declaring more would cost the merchant's trust.
 */
import { PLATFORM_CAPABILITIES } from '@/entities/connection-capability';
import { opRef, type ImageOp, type ImageOpsExecutor } from '@/entities/product-change';
import { mapWixProduct } from '../lib/map-product';
import type { WixClient } from './client';

/** Declared, versioned with this connector. */
export const CAPABILITIES = PLATFORM_CAPABILITIES.wix;

const SUPPORTED = new Set<string>(CAPABILITIES.imageOps);

export function createWixImageOps(client: WixClient): ImageOpsExecutor {
  async function readImages(productSourceId: string) {
    const product = await client.productById(productSourceId);
    return product ? mapWixProduct(product, { collections: new Map() }).images : [];
  }

  return {
    readImages,

    async applyOps(productSourceId, ops) {
      const live = (await readImages(productSourceId))
        .map((i) => i.sourceImageId)
        .filter((id): id is string => !!id);
      const skippedOps: string[] = [];

      const detach = async (id: string): Promise<void> => {
        await client.productRemoveMedia(productSourceId, [id]);
        const at = live.indexOf(id);
        if (at >= 0) live.splice(at, 1);
      };

      /** False = the op could not run against this store (reported, not fatal). */
      const runOne = async (op: ImageOp): Promise<boolean> => {
        switch (op.op) {
          case 'append':
            await client.productAddMedia(productSourceId, [op.image.src]);
            return true;
          case 'remove': {
            if (!live.includes(op.target)) return false;
            // The §2 invariant, re-checked against the store.
            if (live.length <= 1) return false;
            await detach(op.target);
            return true;
          }
          case 'replace': {
            if (!live.includes(op.target)) return false;
            await client.productAddMedia(productSourceId, [op.image.src]);
            await detach(op.target);
            return true;
          }
          default:
            return false;
        }
      };

      for (const [index, op] of ops.entries()) {
        if (!SUPPORTED.has(op.op) || !(await runOne(op))) skippedOps.push(opRef(index, op));
      }
      return { skippedOps };
    }
  };
}
