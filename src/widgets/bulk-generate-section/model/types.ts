export interface ActiveBulkJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  total: number;
  processed: number;
  errors: number;
}

export type FieldKey = 'title' | 'description' | 'tags' | 'alt' | 'images';
export type FieldOutcome = 'done' | { error: string };

export interface ProductBulkState {
  fields: Partial<Record<FieldKey, FieldOutcome>>;
}

export interface BulkJobStatusForUi {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  error: string | null;
  total: number;
  fullySucceeded: number;
  partiallySucceeded: number;
  fullyFailed: number;
  notYetAttempted: number;
  perProduct: Record<string, ProductBulkState>;
}

export interface CostBreakdown {
  productCount: number;
  perProduct: { chat: number; images: number; total: number };
  total: number;
  chatModelId: string;
  imageQualityId: string;
}

export interface BulkCandidate {
  id: string;
  title: string;
  sourceId: string;
  pendingFields: FieldKey[];
  pendingCost: number;
}

export function errorKey(code: string | undefined): string {
  switch (code) {
    case 'plan_not_eligible':
      return 'errorPlanNotEligible';
    case 'bulk_already_running':
    case 'already_running':
      return 'errorAlreadyRunning';
    case 'no_products':
      return 'errorNoProducts';
    case 'no_fields':
      return 'errorNoFields';
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    case 'invalid_selection':
      return 'errorInvalidSelection';
    case 'source_not_found':
      return 'errorSourceNotFound';
    case 'no_failures':
      return 'errorNoFailures';
    default:
      return 'errorGeneric';
  }
}
