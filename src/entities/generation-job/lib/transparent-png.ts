import sharp from 'sharp';

/** Alpha at or above this is treated as fully opaque. Recraft returns the
 *  subject at 250-254 rather than 255 — invisible on white, a faint veil on
 *  a dark page background. Anti-aliased edges sit far below and are kept. */
export const OPAQUE_ALPHA_FLOOR = 250;

/**
 * Snap near-opaque alpha to 255 in place on an RGBA buffer. Pure, so it is
 * testable without an image codec. Returns the number of pixels changed.
 */
export function snapOpaqueAlpha(rgba: Uint8Array, floor = OPAQUE_ALPHA_FLOOR): number {
  let changed = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a >= floor && a < 255) {
      rgba[i] = 255;
      changed += 1;
    }
  }
  return changed;
}

export interface TransparentPngResult {
  png: Buffer;
  width: number;
  height: number;
  /** Share of fully transparent pixels — 0 means the tool removed nothing. */
  transparentRatio: number;
}

/**
 * Normalise a background-removal output into the PNG we store: RGBA, alpha
 * snapped, whatever container the provider chose (it mirrors the input, so a
 * WebP source yields a WebP). Fully in memory — nothing touches the disk.
 */
export async function toTransparentPng(input: Buffer): Promise<TransparentPngResult> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  snapOpaqueAlpha(data);
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent += 1;
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 }
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    png,
    width: info.width,
    height: info.height,
    transparentRatio: transparent / (data.length / 4)
  };
}
