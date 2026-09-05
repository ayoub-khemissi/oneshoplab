/**
 * Default photography "angle" presets the merchant can pick when adding
 * or regenerating an image. The text is fed to kie's image-edit model
 * alongside the source image url; phrasing is tuned to keep the product
 * itself identical and only re-stage the scene around it.
 */
export const IMAGE_ANGLES = [
  'lifestyle',
  'studio',
  'inuse',
  'packshot',
  'flatlay',
  'macro',
  'scale',
  'gift'
] as const;
export type ImageAngle = (typeof IMAGE_ANGLES)[number];

export const IMAGE_ANGLE_PROMPTS: Record<ImageAngle, string> = {
  lifestyle:
    'A lifestyle photo of this product in a natural outdoor setting, soft golden-hour lighting, slight shallow depth of field. The product remains identical to the source — only the surrounding scene changes. Photorealistic, high quality.',
  studio:
    'A clean studio shot of this product on a minimalist warm-neutral background, professional product photography lighting, soft shadow underneath. The product is identical to the source.',
  inuse:
    'A candid lifestyle scene of someone naturally using or wearing this product in an everyday context, authentic and human, warm tones. The product is identical to the source.',
  // Marketplaces (Amazon, Google Shopping) require a pure white background and
  // reject the warm-neutral one `studio` produces — hence a preset of its own.
  packshot:
    'A pure white background packshot of this product, evenly lit with no visible shadow on the background, centred with generous margins, e-commerce marketplace standard. The product is identical to the source.',
  flatlay:
    'A top-down flat lay of this product arranged on a textured neutral surface with two or three simple complementary props, even diffused daylight, tidy composition. The product is identical to the source.',
  macro:
    'An extreme close-up of this product showing its material, texture and finish in sharp detail, soft directional light revealing the surface, very shallow depth of field. The product is identical to the source.',
  // Wrong-size returns are one of e-commerce's most expensive problems, and a
  // photo with a familiar reference answers it better than a dimension table.
  scale:
    'This product photographed beside an everyday object of well-known size, or held in a hand, so its real dimensions read at a glance. Neutral setting, even lighting. The product is identical to the source.',
  gift: 'This product presented as a gift, with tasteful wrapping, ribbon or a gift box nearby, warm festive lighting and a soft background. The product itself is unwrapped and identical to the source.'
};

/** Merchant-supplied free-text wins; otherwise we use the picked angle's
 *  preset. `merchantInstructions` is the project + product instructions
 *  combo and gets appended to either branch. */
export function buildImagePrompt(
  angle: ImageAngle | 'custom',
  customPrompt: string,
  merchantInstructions: string
): string {
  const base = angle === 'custom' ? customPrompt.trim() : IMAGE_ANGLE_PROMPTS[angle];
  const extra = merchantInstructions.trim();
  return extra ? `${base} ${extra}` : base;
}
