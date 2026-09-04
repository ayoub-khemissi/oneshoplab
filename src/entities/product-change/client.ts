// Client-safe surface of the slice: the pure `images` payload helpers only.
// The index barrel opens the db (api/changes, api/apply-loop), so the product
// image editor — a client component — imports its simulation from here.
export {
  IMAGE_OPS_VERSION,
  MAX_IMAGE_OPS,
  expectedImagesAfter,
  imageOpSchema,
  imageOpsPayloadSchema,
  isImageOpsPayload,
  opRef,
  simulateImageOps
} from './lib/image-ops';
export type {
  ImageOp,
  ImageOpsPayload,
  ImageOpsSimulation,
  ImageValueRejection,
  PriorImageRef,
  SimulatedImage
} from './lib/image-ops';
