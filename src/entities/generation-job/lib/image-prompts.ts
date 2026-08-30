/**
 * Default photography "angle" presets the merchant can pick when adding
 * or regenerating an image. The text is fed to kie's image-edit model
 * alongside the source image url; phrasing is tuned to keep the product
 * itself identical and only re-stage the scene around it.
 */
export const IMAGE_ANGLES = ['lifestyle', 'studio', 'inuse'] as const;
export type ImageAngle = (typeof IMAGE_ANGLES)[number];

export const IMAGE_ANGLE_PROMPTS: Record<ImageAngle, string> = {
  lifestyle:
    'A lifestyle photo of this product in a natural outdoor setting, soft golden-hour lighting, slight shallow depth of field. The product remains identical to the source — only the surrounding scene changes. Photorealistic, high quality.',
  studio:
    'A clean studio shot of this product on a minimalist warm-neutral background, professional product photography lighting, soft shadow underneath. The product is identical to the source.',
  inuse:
    'A candid lifestyle scene of someone naturally using or wearing this product in an everyday context, authentic and human, warm tones. The product is identical to the source.'
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
