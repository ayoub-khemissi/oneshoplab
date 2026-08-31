/**
 * Declared, never assumed (docs/api/IMAGE-OPS.md §7). Two sources:
 *   - providers OSL drives itself (Shopify, Wix) — static, versioned with the
 *     connector code, listed here so one server-side resolver can answer for
 *     every platform without a features → features import (each connector
 *     re-exports its entry as its own `CAPABILITIES` const);
 *   - providers that drive themselves (the WooCommerce plugin) — reported on
 *     their `/products/sync` calls and persisted in `connection_capabilities`.
 *
 * Anything unknown or missing gets `MINIMUM_CAPABILITIES`: replace-all only.
 * Degrading is always safe; pretending is not.
 */
import type { ConnectionCapabilities, ShopConnectionPlatform } from '@/shared/db/schema';

export const MINIMUM_CAPABILITIES: ConnectionCapabilities = {
  stableImageIds: false,
  imageOps: [],
  maxImages: 30,
  altEditable: false,
  // Every provider OSL supports today can write the four text-ish fields; the
  // image *ops* are what varies.
  fields: ['title', 'description', 'tags', 'images']
};

/**
 * Shopify Admin API 2025-07. `set_alt` is deliberately absent: editing the alt
 * of an existing MediaImage goes through `fileUpdate`, which needs the
 * `write_files` scope our app does not request (adding it would force every
 * connected merchant to re-consent). Alt text set at creation time still works
 * — `productCreateMedia` takes it. `set_featured` is a `productReorderMedia`
 * move to position 0; Shopify caps a product at 250 media.
 */
const SHOPIFY_CAPABILITIES: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['set_featured', 'append', 'replace', 'remove', 'reorder'],
  maxImages: 250,
  altEditable: false,
  fields: ['title', 'description', 'tags', 'images']
};

/**
 * Wix Stores Catalog v1. Media can be added and removed by id (so `replace` is
 * remove + add), but the API exposes no ordering and no per-item update, hence
 * no `reorder`, no `set_featured` and no `set_alt`. 15 media per product.
 */
const WIX_CAPABILITIES: ConnectionCapabilities = {
  stableImageIds: true,
  imageOps: ['append', 'replace', 'remove'],
  maxImages: 15,
  altEditable: false,
  fields: ['title', 'description', 'tags', 'images']
};

export const PLATFORM_CAPABILITIES: Record<ShopConnectionPlatform, ConnectionCapabilities> = {
  shopify: SHOPIFY_CAPABILITIES,
  wix: WIX_CAPABILITIES
};
