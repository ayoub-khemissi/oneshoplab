/**
 * Background removal is a paid tool on the merchant's own pictures: these
 * tests pin its price against the image pricing policy, the alpha
 * normalisation we promised (a real transparent PNG, fully opaque subject)
 * and the grid's reading of a cut-out row.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  costForImage,
  costForRemoveBackground,
  CREDIT_MARKUP,
  CREDIT_USD_VALUE,
  PROVIDER_UNIT_USD,
  REMOVE_BACKGROUND_TOOL,
  aiSubProcessors
} from '@/entities/ai-model';
import {
  OPAQUE_ALPHA_FLOOR,
  snapOpaqueAlpha,
  toTransparentPng
} from '../../src/entities/generation-job/lib/transparent-png';

describe('remove-background pricing', () => {
  it('applies the image markup to the provider unit and never undercuts cost', () => {
    const cost = costForRemoveBackground();
    expect(cost).toBe(Math.ceil(REMOVE_BACKGROUND_TOOL.cost * CREDIT_MARKUP));
    // What the merchant pays in USD must exceed what kie charges us.
    const revenueUsd = cost * CREDIT_USD_VALUE;
    const costUsd = REMOVE_BACKGROUND_TOOL.cost * PROVIDER_UNIT_USD;
    expect(revenueUsd).toBeGreaterThanOrEqual(costUsd * CREDIT_MARKUP);
    // A cut-out is cheaper than any generation — it does not re-create the picture.
    expect(cost).toBeLessThan(costForImage('image-1k'));
  });

  it('names Recraft as a sub-processor on the legal pages', () => {
    const recraft = aiSubProcessors().find((p) => p.entity.startsWith('Recraft'));
    expect(recraft?.role).toContain('background removal');
  });
});

describe('snapOpaqueAlpha', () => {
  it('lifts near-opaque alpha to 255 and leaves edges and background alone', () => {
    const px = new Uint8Array([
      10,
      20,
      30,
      0, // background
      10,
      20,
      30,
      128, // anti-aliased edge
      10,
      20,
      30,
      OPAQUE_ALPHA_FLOOR, // subject at the floor
      10,
      20,
      30,
      254, // subject
      10,
      20,
      30,
      255 // already opaque
    ]);
    expect(snapOpaqueAlpha(px)).toBe(2);
    expect(Array.from(px.filter((_, i) => i % 4 === 3))).toEqual([0, 128, 255, 255, 255]);
  });
});

describe('toTransparentPng', () => {
  it('returns an RGBA PNG whatever the input container, with the subject fully opaque', async () => {
    // 8x8 WebP: left half opaque-ish (alpha 252), right half transparent.
    const raw = Buffer.alloc(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4;
        raw[i] = 200;
        raw[i + 1] = 50;
        raw[i + 2] = 50;
        raw[i + 3] = x < 4 ? 252 : 0;
      }
    const webp = await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } })
      .webp({ lossless: true })
      .toBuffer();
    const out = await toTransparentPng(webp);
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.channels).toBe(4);
    expect(out.transparentRatio).toBeCloseTo(0.5, 5);
    const { data } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
    const alphas = new Set<number>();
    for (let i = 3; i < data.length; i += 4) alphas.add(data[i]);
    expect([...alphas].sort()).toEqual([0, 255]);
  });

  it('reports a zero transparent ratio when nothing was removed', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect((await toTransparentPng(png)).transparentRatio).toBe(0);
  });
});
