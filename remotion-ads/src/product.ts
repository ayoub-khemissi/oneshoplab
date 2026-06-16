import type { ProductKey } from "./i18n";

/**
 * Hero product shown in the optimize scene. The "before/after" deliberately
 * crosses categories of shot — a flat studio packshot → a rich lifestyle photo —
 * so the AI upgrade is visually obvious. The 3 angles match the app's real
 * "3 images: Studio | Lifestyle | In use" feature.
 */
export const HERO_RAW = "products/sneaker-studio.png"; // before: plain catalog shot
export const HERO_ENHANCED = "products/sneaker-lifestyle.png"; // after: lifestyle

export const HERO_ANGLES: { key: "studio" | "lifestyle" | "inuse"; src: string }[] = [
  { key: "studio", src: "products/sneaker-studio.png" },
  { key: "lifestyle", src: "products/sneaker-lifestyle.png" },
  { key: "inuse", src: "products/sneaker-inuse.png" },
];

/** Maps the 4 catalog products to their generated white-bg thumbnail. */
export const CATALOG_IMG: Record<ProductKey, string> = {
  sneaker: "products/sneaker-studio.png",
  watch: "products/watch.png",
  headphones: "products/headphones.png",
  sunglasses: "products/sunglasses.png",
};
