export {
  ALT_BATCH_MAX_IMAGES,
  buildSetAltOps,
  countMissingAltFromIssues,
  isMissingAlt,
  planAltBatch
} from './lib/batch';
export type { AltBatchPlan, AltCandidateImage, AltCandidateProduct } from './lib/batch';
export { canGenerateAlt, canRunAltBatch } from './lib/capability';
export type { AltImageKind } from './lib/capability';
export {
  generateAltTextAction,
  generateMissingAltForProductAction,
  planMissingAltTextAction
} from './api/actions';
export type {
  AltBatchPlanResult,
  AltBatchProduct,
  AltBatchProductResult,
  AltBatchProgress,
  AltTextErrorCode,
  GenerateAltTextResult
} from './model/types';
