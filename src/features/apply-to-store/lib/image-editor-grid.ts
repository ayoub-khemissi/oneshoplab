/**
 * The one grid of docs/api/IMAGE-OPS.md §4: the gallery as it would look once
 * the queue is applied, followed by the generations that are not on the
 * product yet. Pure, so the naming rules ("Photo 1", "Visuel généré 2") are
 * unit-tested rather than eyeballed.
 *
 * Photo numbers come from the ORIGINAL gallery, not from the preview: the
 * queue reads "Retirer la photo 1", and that has to keep pointing at the tile
 * the merchant clicked even after they moved the others around.
 */
import type { RefNamer } from './image-editor';

export interface GridStoreImage {
  src: string;
  alt: string | null;
  sourceImageId: string | null;
}

export interface GridGeneratedImage {
  jobId: string;
  src: string;
  alt: string | null;
}

export interface GridTile {
  /** Ref used by the ops (store id) or `gen:<jobId>` when off-gallery. */
  domRef: string;
  key: string;
  kind: 'store' | 'generated';
  label: string;
  src: string;
  alt: string | null;
  sourceImageId: string | null;
  inGallery: boolean;
  /** Rank in the previewed gallery; -1 for a generation still off-product. */
  position: number;
}

export interface GridLabels {
  photo: (n: number) => string;
  generated: (n: number) => string;
  /** Used when a ref matches nothing we know — never expected, never a crash. */
  fallback: string;
}

export interface GridInput {
  storeImages: readonly GridStoreImage[];
  generated: readonly GridGeneratedImage[];
  previewImages: readonly { ref: string; src: string; alt: string | null }[];
  /** Alt texts typed on a generated tile, by image url. */
  altDrafts: Readonly<Record<string, string>>;
  labels: GridLabels;
}

export function storeRefOf(image: GridStoreImage, index: number): string {
  return image.sourceImageId ?? `pos:${index}`;
}

export function buildGrid(input: GridInput): { tiles: GridTile[]; namer: RefNamer } {
  const { labels } = input;
  const byRef = new Map(
    input.storeImages.map((img, i) => [storeRefOf(img, i), { img, label: labels.photo(i + 1) }])
  );
  const bySrc = new Map(
    input.generated.map((gen, i) => [gen.src, { gen, label: labels.generated(i + 1) }])
  );
  const namer: RefNamer = {
    byRef: (ref) => byRef.get(ref)?.label ?? labels.fallback,
    bySrc: (src) => bySrc.get(src)?.label ?? labels.fallback
  };

  const gallery: GridTile[] = input.previewImages.map((img, position) => {
    const store = byRef.get(img.ref);
    const gen = bySrc.get(img.src);
    return {
      domRef: img.ref,
      key: store ? `store-${img.ref}` : `gen-${img.src}`,
      kind: store ? 'store' : 'generated',
      label: store?.label ?? gen?.label ?? labels.fallback,
      src: img.src,
      alt: img.alt,
      sourceImageId: store?.img.sourceImageId ?? null,
      inGallery: true,
      position
    };
  });

  const onProduct = new Set(input.previewImages.map((i) => i.src));
  const extras: GridTile[] = input.generated
    .filter((gen) => !onProduct.has(gen.src))
    .map((gen) => ({
      domRef: `gen:${gen.jobId}`,
      key: `gen-${gen.jobId}`,
      kind: 'generated' as const,
      label: bySrc.get(gen.src)?.label ?? labels.fallback,
      src: gen.src,
      alt: input.altDrafts[gen.src] ?? gen.alt,
      sourceImageId: null,
      inGallery: false,
      position: -1
    }));

  return { tiles: [...gallery, ...extras], namer };
}
