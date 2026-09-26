/** Sam's catalog as the audit sees it (before) and after generation. */
export const CATALOG = [
  { img: "img/sneaker-raw.png", after: "img/sneaker-studio.png", name: "sneaker white 01", better: "Off-White Leather High-Top", score: 34, next: 94 },
  { img: "img/watch.png", name: "WATCH SKELETON BRWN", better: "Skeleton Automatic Watch", score: 41, next: 92 },
  { img: "img/headphones.png", name: "Headphones", better: "Wireless ANC Headphones", score: 28, next: 90 },
  { img: "img/sunglasses.png", name: "sunglass tortoise", better: "Tortoiseshell Sunglasses", score: 47, next: 93 },
  { img: "img/demo-tshirt-1.webp", name: "T-shirt", better: "Organic Cotton Crew Tee", score: 22, next: 91 },
  { img: "img/demo-tshirt-2.webp", name: "tee white basic", better: "Heavyweight White Tee", score: 39, next: 95 },
  { img: "img/sneaker-inuse.png", name: "shoes (worn)", better: "High-Top Sneaker · Street", score: 52, next: 96 },
  { img: "img/watch.png", name: "Watch 2", better: "Classic Leather Watch", score: 31, next: 92, flip: true },
  { img: "img/sunglasses.png", name: "sunglasses #2", better: "Round Acetate Sunglasses", score: 44, next: 94, flip: true },
] as const;

export type Product = (typeof CATALOG)[number];

export const GRID = { x0: 60, y0: 560, w: 300, h: 290, gapX: 30, gapY: 26, cols: 3 };

export const cellRect = (i: number) => ({
  left: GRID.x0 + (i % GRID.cols) * (GRID.w + GRID.gapX),
  top: GRID.y0 + Math.floor(i / GRID.cols) * (GRID.h + GRID.gapY),
  width: GRID.w,
  height: GRID.h,
});

export const AVG_BEFORE = 41;
export const AVG_AFTER = 93;
