// Client-safe UI of the slice (no db / next/headers in this graph).
export { ApplyToStoreButton } from './ui/apply-to-store-button';
// A `'use server'` module: Next turns it into an action reference, so client
// code can call it without dragging the server barrel — and the DB driver —
// into the browser bundle.
export { sendAllGenerationsAction } from './api/send-all';
export {
  RECAP_FIELDS,
  buildProductRecap,
  countToApply,
  hasSending,
  isAwaitingStore
} from './lib/product-recap';
export type { RecapField, RecapInput, RecapRow, RecapState } from './lib/product-recap';
export { PendingChangesBanner } from './ui/pending-changes-banner';
export { PendingChangesList } from './ui/pending-changes-list';
export { PendingChangesModal } from './ui/pending-changes-modal';
export { PendingChangesPill } from './ui/pending-changes-pill';
export { ProductImageEditor } from './ui/image-editor/product-image-editor';
export { ProductRecapCard } from './ui/product-recap-card';
export type {
  EditorGeneratedImage,
  EditorStoreImage
} from './ui/image-editor/product-image-editor';
export type {
  AltTextGenerator,
  PendingChangeDetail,
  PendingChangeItem,
  PendingCounts,
  PendingSiteCount
} from './model/types';
