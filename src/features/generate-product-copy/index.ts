export { runChatOptim } from './api/optims';
export type { ChatOptimRequest, ChatOptimResult } from './api/optims';
export { findCachedSuggestions, getOrGenerateSuggestions } from './api/suggestions';
export type { PromptSuggestion, SuggestionsResult } from './api/suggestions';
export {
  buildDescriptionRewritePrompt,
  buildSuggestionPrompt,
  buildTagSuggestionPrompt,
  buildTitleRewritePrompt
} from './lib/prompts';
export type { ProductContext } from './lib/prompts';
