/**
 * The output ratio is the one generation setting whose two knobs are not
 * independent: kie's GPT-Image 2 refuses some (ratio, resolution) pairs, and
 * a rejected createTask costs the merchant a failed job. These tests pin the
 * pairing rules and — more importantly — that an account which never picked
 * a format still generates exactly what it generated before formats existed.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_FORMAT,
  getImageFormat,
  IMAGE_FORMAT_IDS,
  IMAGE_FORMAT_REGISTRY,
  imageFormatChoices,
  imageRequestParams,
  resolveImageFormatId
} from '@/entities/ai-model';
import { IMAGE_FORMAT_IDS as DB_IMAGE_FORMAT_IDS } from '@/shared/db/schema';

describe('image formats', () => {
  it("defaults to 'auto', which is what every generation did before", () => {
    expect(DEFAULT_IMAGE_FORMAT).toBe('auto');
    expect(resolveImageFormatId(null)).toBe('auto');
    expect(resolveImageFormatId(undefined)).toBe('auto');
    expect(resolveImageFormatId('')).toBe('auto');
    // A retired / forged id must not throw, and must not silently reframe
    // somebody's catalogue either — it falls back to the source ratio.
    expect(resolveImageFormatId('portrait-9x21')).toBe('auto');
    expect(getImageFormat('nope').aspectRatio).toBe('auto');
  });

  it('keeps the MySQL enum in sync with the catalog', () => {
    expect([...DB_IMAGE_FORMAT_IDS].sort()).toEqual([...IMAGE_FORMAT_IDS].sort());
  });

  it('exposes the ratios the pickers offer', () => {
    expect(IMAGE_FORMAT_REGISTRY.square.aspectRatio).toBe('1:1');
    expect(IMAGE_FORMAT_REGISTRY.mobile.aspectRatio).toBe('9:16');
    expect(IMAGE_FORMAT_REGISTRY.banner.aspectRatio).toBe('16:9');
  });

  it('passes the ratio through untouched when the provider supports the pair', () => {
    expect(imageRequestParams('banner', 'image-4k')).toEqual({
      aspectRatio: '16:9',
      resolution: '4K',
      clamped: false
    });
    expect(imageRequestParams('mobile', 'image-2k')).toEqual({
      aspectRatio: '9:16',
      resolution: '2K',
      clamped: false
    });
  });

  it('clamps the resolution rather than the ratio on an unsupported pair', () => {
    // Measured against the live API on 2026-09-15, not taken from the docs:
    // kie documents that 1:1 cannot go to 4K, but the task is accepted and
    // returns 2880x2880. What IS refused at 2K and 4K is the ratio itself —
    // 4:5, 3:1, 1:3, 9:21 answer "aspect_ratio is not within the range of
    // allowed options" — and none of those are offered here. So no shipped
    // pair is clamped today; the mechanism stays because a ratio added later
    // may well be capped.
    for (const format of ['auto', 'square', 'mobile', 'banner']) {
      for (const quality of ['image-1k', 'image-2k', 'image-4k']) {
        expect(imageRequestParams(format, quality).clamped).toBe(false);
      }
    }
    expect(imageRequestParams('square', 'image-4k').resolution).toBe('4K');
  });

  it('leaves the legacy request shape untouched for an account with no format', () => {
    for (const quality of ['image-1k', 'image-2k', 'image-4k'] as const) {
      const p = imageRequestParams(null, quality);
      expect(p.aspectRatio).toBe('auto');
      expect(p.clamped).toBe(false);
    }
  });

  it('builds one picker option per catalog format, in catalog order', () => {
    const choices = imageFormatChoices((key) => `t:${key}`);
    expect(choices.map((c) => c.id)).toEqual([...IMAGE_FORMAT_IDS]);
    expect(choices[0]).toMatchObject({ label: 't:auto.name', hint: 't:auto.hint' });
  });
});
