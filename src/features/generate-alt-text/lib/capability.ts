/**
 * Kept as the slice's own door onto the shared rule, which now lives with the
 * capabilities themselves (`entities/connection-capability`) so the bulk run
 * can ask the same question — a feature never imports another feature.
 */
export { canGenerateAlt, canRunAltBatch } from '@/entities/connection-capability';
export type { AltImageKind } from '@/entities/connection-capability';
