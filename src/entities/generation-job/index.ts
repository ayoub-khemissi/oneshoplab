export type { AltTextResult, ChatOptimField, CopyOptimField, ImageJobRow } from './model/types';
export {
  IllegalJobTransition,
  JOB_TRANSITIONS,
  JobNotFound,
  TERMINAL_JOB_STATUSES,
  canTransition,
  transitionJob
} from './api/transitions';
export type { DbExecutor, TransitionOptions, TransitionResult } from './api/transitions';
export { listProductImageJobs } from './api/image-jobs';
export { persistKieJobFailure, persistKieJobSuccess } from './api/persist-result';
export type { KieSuccessMeta } from './api/persist-result';
export { listOptimHistory, listOptimHistoryPaginated } from './api/optim-history';
export type { OptimHistoryItem } from './api/optim-history';
export { runChatOptim } from './api/optims';
export type { ChatOptimRequest, ChatOptimResult } from './api/optims';
export { altTextCredits, runAltTextOptim } from './api/alt-text';
export { generateAltsForNewImages } from './api/image-alts';
export type { AltTextOptimRequest } from './api/alt-text';
export { IMAGE_COST_CREDITS, startImageOptim } from './api/image-optim';
export {
  isRemoveBgInput,
  REMOVE_BG_MAX_DIMENSION,
  REMOVE_BG_MIN_DIMENSION,
  REMOVE_BG_OP,
  startRemoveBackground
} from './api/remove-background';
export type {
  RemoveBgInput,
  StartRemoveBackgroundOptions,
  StartRemoveBackgroundResult
} from './api/remove-background';
export { snapOpaqueAlpha, toTransparentPng, OPAQUE_ALPHA_FLOOR } from './lib/transparent-png';
export type { TransparentPngResult } from './lib/transparent-png';
export type { StartImageOptimOptions, StartImageOptimResult } from './api/image-optim';
export {
  ALT_TEXT_MAX_CHARS,
  buildAltTextPrompt,
  buildDescriptionRewritePrompt,
  buildSuggestionPrompt,
  buildTagSuggestionPrompt,
  buildTitleRewritePrompt,
  sanitizeAltText
} from './lib/prompts';
export type { ProductContext } from './lib/prompts';
export {
  DEFAULT_IMAGE_ANGLES,
  IMAGE_ANGLES,
  IMAGE_ANGLE_PROMPTS,
  LEGACY_DEFAULT_ANGLE_MAP,
  buildImagePrompt
} from './lib/image-prompts';
export type { DefaultImageAngle, ImageAngle } from './lib/image-prompts';
export {
  findCachedSuggestions,
  getOrGenerateSuggestions,
  suggestionsCost
} from './api/prompt-suggestions';
export type { PromptSuggestion, SuggestionsResult } from './api/prompt-suggestions';
