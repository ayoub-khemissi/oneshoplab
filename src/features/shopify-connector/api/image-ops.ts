/**
 * Shopify's `ImageOpsExecutor` (docs/api/IMAGE-OPS.md §7). Ops run in order
 * against the Admin API 2025-07:
 *
 *   append / set_featured(image) / replace → productCreateMedia (+ a reorder
 *   move to position 0 for the featured case), remove / replace → productDeleteMedia,
 *   reorder / set_featured(target) → productReorderMedia.
 *
 * `set_alt` on an EXISTING media is not offered: it goes through `fileUpdate`,
 * which needs `write_files` — a scope our app does not request, so every
 * connected merchant would have to re-consent. Alt on a *new* image is carried
 * by productCreateMedia and works. An op we cannot run, and one whose target is
 * no longer on the product, are both reported in `skippedOps`, never fatal.
 */
import { PLATFORM_CAPABILITIES } from '@/entities/connection-capability';
import { opRef, type ImageOp, type ImageOpsExecutor } from '@/entities/product-change';
import { mapAdminProduct } from '../lib/map-product';
import type { ShopifyAdminClient } from './admin-client';

/** Declared, versioned with this connector. */
export const CAPABILITIES = PLATFORM_CAPABILITIES.shopify;

const SUPPORTED = new Set<string>(CAPABILITIES.imageOps);

export function createShopifyImageOps(
  client: ShopifyAdminClient,
  shopDomain: string
): ImageOpsExecutor {
  async function readImages(productSourceId: string) {
    const product = await client.productById(productSourceId);
    if (!product) return [];
    return mapAdminProduct(product, { shopDomain, currency: null }).images;
  }

  return {
    readImages,

    async applyOps(productSourceId, ops) {
      const live = (await readImages(productSourceId))
        .map((i) => i.sourceImageId)
        .filter((id): id is string => !!id);
      const skippedOps: string[] = [];
      // ref (store id or `new:<n>`) → media gid, filled as media is created.
      const resolved = new Map<string, string>(live.map((id) => [id, id]));
      let introduced = 0;

      const create = async (src: string, alt: string | null): Promise<string | null> => {
        const ids = await client.productCreateMedia(productSourceId, [
          { originalSource: src, alt }
        ]);
        return ids[0] ?? null;
      };

      for (const [index, op] of ops.entries()) {
        const ref = opRef(index, op);
        if (!SUPPORTED.has(op.op)) {
          skippedOps.push(ref);
          continue;
        }
        if (!(await runOne(op, ref))) skippedOps.push(ref);
      }
      return { skippedOps };

      /** False = the op could not run against this store (reported, not fatal). */
      async function runOne(op: ImageOp, ref: string): Promise<boolean> {
        switch (op.op) {
          case 'append': {
            const key = `new:${introduced++}`;
            const id = await create(op.image.src, op.image.alt ?? null);
            if (id) {
              resolved.set(key, id);
              live.push(id);
            }
            return true;
          }
          case 'set_featured': {
            if (op.target === undefined) {
              const image = op.image;
              if (!image) return false;
              const key = `new:${introduced++}`;
              const id = await create(image.src, image.alt ?? null);
              if (!id) return false;
              resolved.set(key, id);
              live.push(id);
              await client.productReorderMedia(productSourceId, [{ id, newPosition: 0 }]);
              return true;
            }
            const id = resolved.get(op.target);
            if (!id) return false;
            await client.productReorderMedia(productSourceId, [{ id, newPosition: 0 }]);
            return true;
          }
          case 'replace': {
            const gone = resolved.get(op.target);
            // The counter advances even when the target is gone, so the
            // `new:<n>` numbering the client computed stays aligned (§2).
            const key = `new:${introduced++}`;
            if (!gone) return false;
            const id = await create(op.image.src, op.image.alt ?? null);
            if (id) {
              resolved.set(key, id);
              live.push(id);
            }
            await detach(gone);
            return true;
          }
          case 'remove': {
            const id = resolved.get(op.target);
            if (!id) return false;
            // The §2 invariant, re-checked against the store: never leave a
            // product with zero images, whatever OSL believed at approval.
            if (live.length <= 1) return false;
            await detach(id);
            return true;
          }
          case 'reorder': {
            const moves = op.order
              .map((r) => resolved.get(r))
              .filter((id): id is string => !!id)
              .map((id, position) => ({ id, newPosition: position }));
            if (moves.length === 0) return false;
            await client.productReorderMedia(productSourceId, moves);
            return true;
          }
          case 'set_alt':
            return false;
        }
      }

      async function detach(id: string): Promise<void> {
        await client.productDeleteMedia(productSourceId, [id]);
        const at = live.indexOf(id);
        if (at >= 0) live.splice(at, 1);
        for (const [k, v] of resolved) if (v === id) resolved.delete(k);
      }
    }
  };
}
