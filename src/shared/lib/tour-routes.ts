/**
 * Route constants shared by the guided tour, the product page and the
 * resolver route between them.
 *
 * They live in shared rather than in the tour feature because the server
 * needs them: the tour's public barrel pulls next-auth, so importing it from
 * a view or a route handler drags authentication into places that only want
 * a string (and breaks under vitest).
 */

/** Product id the tour opens when the merchant has no catalogue yet. */
export const DEMO_PRODUCT_ID = 'demo';

/** URL segment that resolves to a real product, or to the sample. */
export const FIRST_PRODUCT_SEGMENT = 'first';
