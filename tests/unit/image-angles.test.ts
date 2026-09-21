import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_ANGLES,
  IMAGE_ANGLES,
  IMAGE_ANGLE_PROMPTS
} from '../../src/entities/generation-job/lib/image-prompts';
import { BULK_ANGLES, resolveBulkPrefs } from '../../src/features/bulk-generate/model/types';

describe('image angles', () => {
  it('generate-all produces white background, in-use, lifestyle in that order', () => {
    expect([...DEFAULT_IMAGE_ANGLES]).toEqual(['packshot', 'inuse', 'lifestyle']);
    expect(BULK_ANGLES).toEqual([...DEFAULT_IMAGE_ANGLES]);
  });

  it('the style picker lists the default trio first, then studio and the rest', () => {
    expect(IMAGE_ANGLES.slice(0, 4)).toEqual(['packshot', 'inuse', 'lifestyle', 'studio']);
    for (const a of IMAGE_ANGLES) expect(IMAGE_ANGLE_PROMPTS[a]).toBeTruthy();
  });

  it('only keeps the transparent packshot when the packshot angle is in the run', () => {
    expect(resolveBulkPrefs({ transparentPackshot: true }).transparentPackshot).toBe(true);
    expect(
      resolveBulkPrefs({ transparentPackshot: true, imageAngles: ['inuse'] }).transparentPackshot
    ).toBe(false);
    expect(
      resolveBulkPrefs({ transparentPackshot: true, fields: { images: false } }).transparentPackshot
    ).toBe(false);
    expect(resolveBulkPrefs(null).transparentPackshot).toBe(false);
  });

  it('legacy bulk prefs saved with studio resolve to packshot', () => {
    const prefs = resolveBulkPrefs({ imageAngles: ['studio', 'inuse'] });
    expect(prefs.imageAngles).toEqual(['packshot', 'inuse']);
    expect(resolveBulkPrefs(null).imageAngles).toEqual(['packshot', 'inuse', 'lifestyle']);
  });
});
