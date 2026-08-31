/**
 * The `capabilities` object a self-driving plugin reports (IMAGE-OPS.md §7).
 * Every field is optional: a plugin that only knows half the contract still
 * gets a coherent answer, the rest falling back to the safe minimum.
 */
import { z } from 'zod';
import {
  IMAGE_OP_VERBS,
  PRODUCT_CHANGE_FIELDS,
  type ConnectionCapabilities
} from '@/shared/db/schema';
import { MINIMUM_CAPABILITIES } from '../model/capabilities';

/** A product cannot carry more than this whatever a plugin claims. */
export const MAX_DECLARABLE_IMAGES = 250;

export const capabilitiesSchema = z.object({
  stableImageIds: z.boolean().optional(),
  imageOps: z.array(z.enum(IMAGE_OP_VERBS)).max(IMAGE_OP_VERBS.length).optional(),
  maxImages: z.number().int().min(1).max(MAX_DECLARABLE_IMAGES).optional(),
  altEditable: z.boolean().optional(),
  fields: z.array(z.enum(PRODUCT_CHANGE_FIELDS)).max(PRODUCT_CHANGE_FIELDS.length).optional()
});

export type ReportedCapabilities = z.infer<typeof capabilitiesSchema>;

/** Reported → stored shape, holes filled with the minimum. */
export function normalizeCapabilities(reported: ReportedCapabilities): ConnectionCapabilities {
  const stableImageIds = reported.stableImageIds ?? MINIMUM_CAPABILITIES.stableImageIds;
  return {
    stableImageIds,
    // Ops without stable ids cannot address anything: refuse the combination
    // rather than offering buttons that would silently do nothing.
    imageOps: stableImageIds ? (reported.imageOps ?? MINIMUM_CAPABILITIES.imageOps) : [],
    maxImages: reported.maxImages ?? MINIMUM_CAPABILITIES.maxImages,
    altEditable: reported.altEditable ?? MINIMUM_CAPABILITIES.altEditable,
    fields: reported.fields ?? MINIMUM_CAPABILITIES.fields
  };
}
