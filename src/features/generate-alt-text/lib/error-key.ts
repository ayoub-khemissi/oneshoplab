import type { AltTextErrorCode } from '../model/types';

/**
 * Action error code → key under the `AltText` namespace. Only the cases the
 * merchant can act on get their own sentence; `unauthorized` / `bad_request` /
 * `not_found` mean the page is out of date, which the generic message says
 * without inventing a cause.
 */
export function errorKeyFor(code: AltTextErrorCode | string | undefined): string {
  switch (code) {
    case 'unsupported':
      return 'errorUnsupported';
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    case 'nothing_missing':
      return 'errorNothingMissing';
    case 'archived':
      return 'errorArchived';
    default:
      return 'errorGeneric';
  }
}
