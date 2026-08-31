// Client-safe UI + helpers of the slice (no db / next/headers in this graph).
export { BulkAltTextCard } from './ui/bulk-alt-text-card';
export { errorKeyFor } from './lib/error-key';
export type {
  AltBatchPlanResult,
  AltBatchProduct,
  AltBatchProductResult,
  AltBatchProgress,
  AltTextErrorCode,
  GenerateAltTextResult
} from './model/types';
