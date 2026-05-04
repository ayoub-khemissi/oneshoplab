/**
 * Model registry — single source of truth for the LLMs and image models we
 * expose to merchants. Each entry stores:
 *   - kieModelId: the actual model identifier passed to the kie.ai API
 *   - kieCost: kie's billing rate (image = per call, chat = per million tokens)
 *   - oneShopLab credits price after applying the global CREDIT_MARKUP factor
 *   - tier label for grouping in UI selectors
 *
 * The markup is centralised here so changing it later only touches one file.
 * All credit debits in the codebase MUST run through `costForChatResponse` or
 * `costForImageGeneration` to stay consistent.
 */

/**
 * Markup applied to kie's raw credit cost when billing the merchant.
 * Default 2.5x (≈70-78% gross margin at typical usage). Tunable via env so
 * pricing can be re-balanced without a code change. Clamped to [1, 10] to
 * guard against typos that would either lose money or chase users away.
 */
function readMarkup(): number {
  const raw = process.env.CREDIT_MARKUP_FACTOR;
  if (!raw) return 2.5;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) return 2.5;
  return parsed;
}

export const CREDIT_MARKUP = readMarkup();

/** 1 OneShopLab credit = $0.005 retail. */
export const CREDIT_USD_VALUE = 0.005;

// ---------------------------------------------------------------------------
// Chat models
// ---------------------------------------------------------------------------

export type ChatModelId = 'gemini-3-1-pro' | 'sonnet-4-6' | 'opus-4-6';

export interface ChatModelInfo {
  id: ChatModelId;
  /** Identifier passed to kie's `/claude/v1/messages`. */
  kieModelId: string;
  displayName: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google';
  tier: 'budget' | 'balanced' | 'premium';
  /** kie's billing rates per million tokens (raw kie credits). */
  kieInputPerM: number;
  kieOutputPerM: number;
  /** Short pitch shown in the model selector. */
  tagline: string;
}

export const CHAT_MODEL_REGISTRY: Record<ChatModelId, ChatModelInfo> = {
  'gemini-3-1-pro': {
    id: 'gemini-3-1-pro',
    kieModelId: 'gemini-3-1-pro',
    displayName: 'Gemini 3.1 Pro',
    provider: 'Google',
    tier: 'budget',
    kieInputPerM: 100,
    kieOutputPerM: 700,
    tagline: 'Fast and economical — great for bulk runs.'
  },
  'sonnet-4-6': {
    id: 'sonnet-4-6',
    kieModelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    tier: 'balanced',
    kieInputPerM: 170,
    kieOutputPerM: 855,
    tagline: 'Best price / quality balance for product copy.'
  },
  'opus-4-6': {
    id: 'opus-4-6',
    kieModelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    provider: 'Anthropic',
    tier: 'premium',
    kieInputPerM: 285,
    kieOutputPerM: 1430,
    tagline: 'Top-tier reasoning — premium tone and edge cases.'
  }
};

export const DEFAULT_CHAT_MODEL: ChatModelId = 'sonnet-4-6';

export function getChatModel(id: ChatModelId | string | null | undefined): ChatModelInfo {
  if (id && id in CHAT_MODEL_REGISTRY) {
    return CHAT_MODEL_REGISTRY[id as ChatModelId];
  }
  return CHAT_MODEL_REGISTRY[DEFAULT_CHAT_MODEL];
}

/** Convert a kie chat response's `credits_consumed` into the user-facing debit. */
export function chatCreditsToDebit(kieCreditsConsumed: number): number {
  return Math.ceil(kieCreditsConsumed * CREDIT_MARKUP);
}

/**
 * Estimate the credit cost of a chat call BEFORE running it. Used to render
 * "Generate · X credits" buttons. Uses typical token counts per field; the
 * real debit comes from kie's `credits_consumed` after the call.
 */
export interface ChatTokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export const FIELD_TOKEN_ESTIMATES: Record<
  'title' | 'description' | 'tags' | 'social' | 'fullAudit',
  ChatTokenEstimate
> = {
  title: { inputTokens: 600, outputTokens: 80 },
  description: { inputTokens: 600, outputTokens: 950 },
  tags: { inputTokens: 600, outputTokens: 90 },
  social: { inputTokens: 600, outputTokens: 800 },
  fullAudit: { inputTokens: 2500, outputTokens: 1900 }
};

export function estimateChatCredits(
  modelId: ChatModelId,
  field: keyof typeof FIELD_TOKEN_ESTIMATES
): number {
  const m = CHAT_MODEL_REGISTRY[modelId];
  const t = FIELD_TOKEN_ESTIMATES[field];
  const inCost = (t.inputTokens * m.kieInputPerM) / 1_000_000;
  const outCost = (t.outputTokens * m.kieOutputPerM) / 1_000_000;
  const kieCredits = inCost + outCost;
  return Math.max(1, Math.ceil(kieCredits * CREDIT_MARKUP));
}

// ---------------------------------------------------------------------------
// Image models
// ---------------------------------------------------------------------------

export type ImageQualityId = 'image-1k' | 'image-2k' | 'image-4k';

export interface ImageModelInfo {
  id: ImageQualityId;
  kieModelId: string;
  displayName: string;
  resolution: '1K' | '2K' | '4K';
  tier: 'budget' | 'balanced' | 'premium';
  /** kie's flat per-call cost in raw kie credits. */
  kieCost: number;
  tagline: string;
}

export const IMAGE_MODEL_REGISTRY: Record<ImageQualityId, ImageModelInfo> = {
  'image-1k': {
    id: 'image-1k',
    kieModelId: 'gpt-image-2-image-to-image',
    displayName: '1K · Standard',
    resolution: '1K',
    tier: 'budget',
    kieCost: 6,
    tagline: 'Fast and crisp — fine for thumbnails and listings.'
  },
  'image-2k': {
    id: 'image-2k',
    kieModelId: 'gpt-image-2-image-to-image',
    displayName: '2K · High',
    resolution: '2K',
    tier: 'balanced',
    kieCost: 10,
    tagline: 'Sharp lifestyle shots — recommended for hero images.'
  },
  'image-4k': {
    id: 'image-4k',
    kieModelId: 'gpt-image-2-image-to-image',
    displayName: '4K · Premium',
    resolution: '4K',
    tier: 'premium',
    kieCost: 16,
    tagline: 'Print-grade quality — agencies and luxury brands.'
  }
};

export const DEFAULT_IMAGE_QUALITY: ImageQualityId = 'image-1k';

export function getImageModel(id: ImageQualityId | string | null | undefined): ImageModelInfo {
  if (id && id in IMAGE_MODEL_REGISTRY) {
    return IMAGE_MODEL_REGISTRY[id as ImageQualityId];
  }
  return IMAGE_MODEL_REGISTRY[DEFAULT_IMAGE_QUALITY];
}

/** Per-image flat cost in user-facing OneShopLab credits. */
export function costForImage(qualityId: ImageQualityId): number {
  const m = IMAGE_MODEL_REGISTRY[qualityId];
  return Math.ceil(m.kieCost * CREDIT_MARKUP);
}

// ---------------------------------------------------------------------------
// Subscription tiers — used by the pricing page and signup flow.
// ---------------------------------------------------------------------------

export type PlanId = 'free' | 'starter' | 'pro' | 'scale';
export type BillingCycle = 'monthly' | 'yearly';

/** Yearly subscriptions get a -20% discount vs 12× the monthly price. */
export const YEARLY_DISCOUNT = 0.2;

export interface PlanTier {
  id: PlanId;
  name: string;
  /** Monthly retail price in USD. Yearly price = monthly × 12 × (1 - YEARLY_DISCOUNT). */
  priceUsd: number;
  /** Monthly credits granted. For `free` this is a one-shot signup grant. */
  credits: number;
  recurring: boolean;
  /** Approximate full-product generations a typical user can run on this plan. */
  approxFullGenerations: number;
  /** Max number of distinct stores (projects) the user can audit on this plan. */
  siteLimit: number;
  highlights: string[];
}

/** Resolve the site quota for a plan id. Falls back to the free tier limit. */
export function siteLimitForPlan(plan: string | null | undefined): number {
  const tier = PLAN_TIERS.find((p) => p.id === plan);
  return tier?.siteLimit ?? PLAN_TIERS[0].siteLimit;
}

export function yearlyPriceUsd(monthlyPriceUsd: number): number {
  return Math.round(monthlyPriceUsd * 12 * (1 - YEARLY_DISCOUNT) * 100) / 100;
}

/** Monthly-equivalent display price for a yearly cycle (e.g. $39.99/mo → $31.99/mo billed yearly). */
export function yearlyMonthlyEquivalent(monthlyPriceUsd: number): number {
  return Math.round(monthlyPriceUsd * (1 - YEARLY_DISCOUNT) * 100) / 100;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    credits: 150,
    recurring: false,
    approxFullGenerations: 3,
    siteLimit: 1,
    highlights: ['150 credits at signup', '1 store', 'All models available', 'No card required']
  },
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 39.99,
    credits: 5500,
    recurring: true,
    approxFullGenerations: 110,
    siteLimit: 3,
    highlights: [
      '5,500 credits / month',
      'Up to 3 stores',
      '~110 product generations',
      'All models available',
      'Email support'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: 89.99,
    credits: 15000,
    recurring: true,
    approxFullGenerations: 300,
    siteLimit: 10,
    highlights: [
      '15,000 credits / month',
      'Up to 10 stores',
      '~300 product generations',
      'Priority generations',
      'Priority support'
    ]
  },
  {
    id: 'scale',
    name: 'Scale',
    priceUsd: 199.99,
    credits: 38000,
    recurring: true,
    approxFullGenerations: 760,
    siteLimit: 50,
    highlights: [
      '38,000 credits / month',
      'Up to 50 stores',
      '~760 product generations',
      'Bulk operations',
      'Dedicated success manager'
    ]
  }
];

export const SIGNUP_FREE_CREDITS = PLAN_TIERS[0].credits;
