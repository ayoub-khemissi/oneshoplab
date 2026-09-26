export interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/**
 * A photo as the `products` row holds it — with the store's own id when it
 * reported one (docs/api/IMAGE-OPS.md §1). The audit summary's snapshot does
 * not carry that id, so the image editor reads the row, never the snapshot.
 */
export interface StoreImage {
  src: string;
  alt: string | null;
  sourceImageId: string | null;
}

export interface ProductVariant {
  id: string;
  title: string | null;
  price: number;
  options: Record<string, string>;
}

export interface ProductSnapshot {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  descriptionHtml: string;
  images: ProductImage[];
  variants: ProductVariant[];
  score: number;
  signals: {
    tags: string[];
    vendor: string | null;
    productType: string | null;
    descriptionTextLength?: number;
    imageCount?: number;
    priceMin?: number | null;
    priceMax?: number | null;
  };
}

export interface LoadedProduct {
  projectId: string;
  product: ProductSnapshot;
  /** The gallery OSL knows, in store order, with the ids the image editor
   *  addresses (the snapshot in `product.images` has none). */
  storeImages: StoreImage[];
  /** Soft-archived: not in the latest scrape. Banner is shown and
   *  generation buttons are disabled. */
  archived: boolean;
  /** Last per-product instructions persisted by the API on previous
   *  generations. Pre-fills the textarea on render. */
  productInstructions: string;
  /** The merchant's own image prompt for this product, so the "new image"
   *  modal opens on what they wrote last time instead of an empty field. */
  productImagePrompt: string;
  /** Site-wide instructions configured on the project. Surfaced as a hint
   *  on the product page so the merchant knows extra guidance is in flight. */
  projectInstructions: string;
  /** True when the parent project is a from-scratch / manual store
   *  (no upstream Shopify/WooCommerce/Wix). Unlocks the "Apply AI
   *  to my product" CTA, since for scraped sites the source of
   *  truth lives upstream and overwriting locally would be lossy. */
  isManual: boolean;
}
