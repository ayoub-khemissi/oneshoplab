/**
 * Result shapes of the alt-text actions. Every failure is a code the UI turns
 * into one sentence the merchant can act on — no provider message ever crosses
 * this boundary.
 */

export type AltTextErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'archived'
  | 'unsupported'
  | 'insufficient_credits'
  | 'nothing_missing'
  | 'generation_failed';

export type GenerateAltTextResult =
  | {
      ok: true;
      alt: string;
      creditsConsumed: number;
      /** A `set_alt` is on its way to the store. False for a generated image
       *  that is not on the product yet — its alt travels with it instead. */
      changeQueued: boolean;
    }
  | { ok: false; error: AltTextErrorCode };

/** One row of the planned batch, as the progress UI needs it. */
export interface AltBatchProduct {
  productId: string;
  title: string;
  /** Photos of that product this run would describe. */
  images: number;
}

export type AltBatchPlanResult =
  | {
      ok: true;
      products: AltBatchProduct[];
      /** Photos this run covers (capped). */
      images: number;
      /** Photos still missing an alt text after this run. */
      remaining: number;
      /** Credits the whole run costs, quoted before anything is spent. */
      cost: number;
    }
  | { ok: false; error: AltTextErrorCode };

export type AltBatchProductResult =
  { ok: true; generated: number; changeQueued: boolean } | { ok: false; error: AltTextErrorCode };

/** What the client accumulates across the loop and shows as the summary. */
export interface AltBatchProgress {
  done: number;
  total: number;
  generated: number;
  changes: number;
  failed: number;
}
