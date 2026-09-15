import { IMAGE_FORMAT_IDS } from '../model/pricing';
import { IMAGE_FORMAT_REGISTRY, type ImageFormatId } from '../model/models';

/**
 * One catalog format turned into something a picker can draw. Structurally
 * compatible with `ImageFormatOption` in shared/ui, without importing it —
 * this module is pulled into server bundles too and has no business
 * carrying a React barrel along.
 */
export interface ImageFormatChoice {
  id: ImageFormatId;
  label: string;
  aspectRatio: string;
  hint: string;
}

/**
 * Build the picker options from the catalog, translated by the caller.
 *
 * Every surface that offers the ratio (account preferences, the product
 * page picker, the per-image modal, the bulk config) renders the SAME list
 * in the SAME order, from pricing.json — adding a ratio there adds it
 * everywhere rather than in four hand-maintained arrays.
 *
 * `t` is a next-intl translator scoped to the `ImageFormats` namespace; it
 * stays a parameter so this helper works in client and server components
 * alike and needs no next-intl import of its own.
 */
export function imageFormatChoices(t: (key: string) => string): ImageFormatChoice[] {
  return IMAGE_FORMAT_IDS.map((id) => ({
    id,
    label: t(`${id}.name`),
    aspectRatio: IMAGE_FORMAT_REGISTRY[id].aspectRatio,
    hint: t(`${id}.hint`)
  }));
}
