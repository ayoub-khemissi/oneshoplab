/**
 * AI alt text for ONE product photo (docs/api/IMAGE-OPS.md §4: "Alt text is a
 * first-class action … the safest SEO win"). It is the only generation that
 * sends an image to a text model, so it is the only one that has to care
 * whether the model can see.
 *
 * Everything money- and lifecycle-related is runChatJob's: this module owns
 * the model choice, the prompt and the sanitising.
 */
import {
  estimateChatCredits,
  outputTokenCapFor,
  visionChatModel,
  type ChatModelId
} from '@/entities/ai-model';
import { languageNameForPrompt } from '@/shared/i18n';
import { ALT_TEXT_MAX_CHARS, buildAltTextPrompt, sanitizeAltText } from '../lib/prompts';
import type { ProductContext } from '../lib/prompts';
import type { AltTextResult } from '../model/types';
import { runChatJob } from './chat-job';

export interface AltTextOptimRequest {
  userId: string;
  projectId: string;
  productSourceId: string;
  /** Absolute URL of the photo to describe (store image or R2 generation). */
  imageSrc: string;
  /** The store's own id for that photo, when it reported one — stored on the
   *  job so a later `set_alt` op can be traced back to its generation. */
  imageSourceImageId?: string | null;
  product: ProductContext;
  /** Effective ISO 639-1 language code resolved by getEffectiveLanguage(). */
  languageCode: string;
  /** Caller's model pick. Absent → the 'fast' system model; a pick that
   *  cannot read images is swapped for one that can (visionChatModel). */
  chatModelId?: ChatModelId | null;
}

/**
 * The credit price of one alt text, quoted before the call and debited after.
 * Exported so a batch can be refused up front instead of half-run: the
 * merchant sees "not enough credits", not eight alts and a failure.
 */
export function altTextCredits(chatModelId?: ChatModelId | null): number {
  return estimateChatCredits(visionChatModel(chatModelId).id, 'alt');
}

/**
 * A short answer needs almost no headroom, but a model that starts with a
 * refusal or a preamble would be cut mid-word and yield a garbled alt. 3× the
 * priced cap (60 → 180) is cheap insurance: the prompt's 125-character rule is
 * what actually bounds the output, and we bill the cap either way.
 */
const SAFETY_MULTIPLIER = 3;

export async function runAltTextOptim(opts: AltTextOptimRequest): Promise<AltTextResult> {
  const model = visionChatModel(opts.chatModelId);
  const built = buildAltTextPrompt(
    opts.product,
    opts.imageSrc,
    languageNameForPrompt(opts.languageCode)
  );

  const run = await runChatJob<string>({
    userId: opts.userId,
    projectId: opts.projectId,
    productSourceId: opts.productSourceId,
    kind: 'kie_alt_text',
    inputPayload: {
      field: 'alt',
      imageSrc: opts.imageSrc,
      imageSourceImageId: opts.imageSourceImageId ?? null
    },
    model,
    system: built.system,
    messages: [{ role: 'user', content: built.user }],
    maxTokens: Math.ceil(outputTokenCapFor('alt') * SAFETY_MULTIPLIER),
    debit: estimateChatCredits(model.id, 'alt'),
    parse: sanitizeAltText
    // No bell entry on purpose: the batch action fans this out up to 25 times
    // per click, and 25 notifications for one action is noise, not news. Both
    // callers report the outcome in place.
  });

  return {
    alt: run.output.slice(0, ALT_TEXT_MAX_CHARS),
    jobId: run.jobId,
    creditsConsumed: run.creditsConsumed
  };
}
