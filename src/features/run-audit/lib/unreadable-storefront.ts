/**
 * "We could not read this storefront" is not a failure to report — it is the
 * moment to ask for the connection.
 *
 * Any platform can be unreadable from the outside: a password-protected store,
 * a theme with no public catalogue endpoint, a bot filter. The merchant did
 * nothing wrong and there is nothing for them to fix on their side; the store
 * connection is the answer, and it is a better answer than the scrape ever was.
 * Calling it "Audit échoué" teaches them the product does not work.
 */

/** Audit errors that mean "the outside view told us nothing". */
const UNREADABLE_ERRORS = new Set([
  'platform_not_detected',
  'no_report',
  // Historical rows, before the reasons became codes.
  'Could not detect a supported e-commerce platform on this URL.'
]);

export interface UnreadableStorefrontInput {
  /** The audit's own error, as stored. */
  error: string | null;
  /** Where the catalogue came from: only a storefront read can be unreadable. */
  source: 'storefront' | 'connection';
  /** A live integration already exists — then a failure IS worth reporting. */
  hasConnection: boolean;
}

/**
 * True when the audit's failure should be turned into an invitation to connect
 * rather than an error.
 *
 * A store that is already connected is excluded on purpose: there the failure
 * is real, the merchant has no further step to take, and hiding it would leave
 * them with a store that silently stops being analysed.
 */
export function isUnreadableStorefront(input: UnreadableStorefrontInput): boolean {
  if (input.hasConnection || input.source !== 'storefront') return false;
  return UNREADABLE_ERRORS.has((input.error ?? '').trim());
}
