/**
 * Model registry — static identifiers + display copy for the LLMs and image
 * models we expose to merchants. All numeric levers (kie rates, markup,
 * caps, plan credits, credit-pack pricing) live in `pricing.json` and are
 * loaded via `./pricing`. This file only owns:
 *   - kieModelId  (the string passed to kie's API — stable, code-y)
 *   - displayName / provider / tier / tagline (UI copy)
 *   - the merge function that combines static metadata with JSON numbers
 *
 * Pricing math is deterministic: every chat field has a hard input/output
 * token cap (see fieldCaps in pricing.json), the cost shown to the user is
 * cap × kie-rate × markup, and runChatOptim sends max_tokens = outputCap
 * to kie so we can never exceed the quoted cost. The user is debited
 * exactly the quoted amount — no surprise tail debits.
 */

import {
  CHAT_MODEL_IDS,
  CREDIT_PACK_IDS,
  FIELD_IDS,
  IMAGE_QUALITY_IDS,
  PLAN_IDS,
  PRICING,
  type CreditPackId as PricingCreditPackId,
  type PricingChatModelId,
  type PricingFieldId,
  type PricingImageQualityId,
  type PricingPlanId
} from './pricing';

export const CREDIT_MARKUP = PRICING.creditMarkupFactor;
export const CREDIT_USD_VALUE = PRICING.creditUsdValue;

/**
 * Hard cap on the length of merchant-supplied custom instructions, both at
 * the per-product and at the per-site level. Enforced server-side (the API
 * truncates) and surfaced client-side via maxLength + a counter, so the
 * input-token portion of every generation stays bounded and the cost
 * displayed on the buttons remains accurate.
 */
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 750;

/**
 * Generated AI images are retained in R2 + DB for this many days, then
 * dropped by the worker's hourly cleanup tick. Surfaced in the UI as
 * "expires in N days" so merchants know to download anything they want
 * to keep before the deadline.
 */
export const IMAGE_RETENTION_DAYS = 30;

/**
 * Static re-audit rate limit: a fixed 24-hour rolling window, with the
 * number of allowed runs per window equal to the plan's site quota.
 *
 * Rate is per USER (not per site) — locking per site would let merchants
 * delete and recreate sites to keep launching audits indefinitely.
 *
 *   Free    →  1 audit / 24h
 *   Starter →  3 audits / 24h
 *   Pro     → 10 audits / 24h
 *   Scale   → 50 audits / 24h
 *
 * Failed and timed-out audits don't count toward the quota so a bad
 * first run doesn't lock the merchant out for 24 hours.
 */
export const AUDIT_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function auditRateLimitForPlan(plan: string | null | undefined): number {
  return siteLimitForPlan(plan);
}

// ---------------------------------------------------------------------------
// Chat models
// ---------------------------------------------------------------------------

export type ChatModelId = PricingChatModelId;

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

const CHAT_MODEL_META: Record<
  ChatModelId,
  Omit<ChatModelInfo, 'id' | 'kieInputPerM' | 'kieOutputPerM'>
> = {
  'gemini-3-1-pro': {
    kieModelId: 'gemini-3-1-pro',
    displayName: 'Gemini 3.1 Pro',
    provider: 'Google',
    tier: 'budget',
    tagline: 'Fast and economical — great for bulk runs.'
  },
  'sonnet-4-6': {
    kieModelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    tier: 'balanced',
    tagline: 'Best price / quality balance for product copy.'
  },
  'opus-4-6': {
    kieModelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    provider: 'Anthropic',
    tier: 'premium',
    tagline: 'Top-tier reasoning — premium tone and edge cases.'
  }
};

export const CHAT_MODEL_REGISTRY: Record<ChatModelId, ChatModelInfo> =
  Object.fromEntries(
    CHAT_MODEL_IDS.map((id) => [
      id,
      {
        id,
        ...CHAT_MODEL_META[id],
        kieInputPerM: PRICING.chatModels[id].kieInputPerM,
        kieOutputPerM: PRICING.chatModels[id].kieOutputPerM
      } satisfies ChatModelInfo
    ])
  ) as Record<ChatModelId, ChatModelInfo>;

export const DEFAULT_CHAT_MODEL: ChatModelId = 'sonnet-4-6';

export function getChatModel(id: ChatModelId | string | null | undefined): ChatModelInfo {
  if (id && id in CHAT_MODEL_REGISTRY) {
    return CHAT_MODEL_REGISTRY[id as ChatModelId];
  }
  return CHAT_MODEL_REGISTRY[DEFAULT_CHAT_MODEL];
}

// ---------------------------------------------------------------------------
// Per-field deterministic costs
// ---------------------------------------------------------------------------

export interface ChatTokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

export const FIELD_TOKEN_ESTIMATES: Record<PricingFieldId, ChatTokenEstimate> =
  Object.fromEntries(
    FIELD_IDS.map((id) => [
      id,
      {
        inputTokens: PRICING.fieldCaps[id].inputTokens,
        outputTokens: PRICING.fieldCaps[id].outputTokens
      } satisfies ChatTokenEstimate
    ])
  ) as Record<PricingFieldId, ChatTokenEstimate>;

/**
 * Deterministic credit cost for a chat call. Computed from the per-field
 * cap (input + output) × kie's per-million rate × markup, ceilinged to an
 * integer. This is BOTH the price shown on the button AND the amount the
 * user is debited — there is no separate "actual usage" pass, because the
 * generation is hard-capped at outputTokens.
 */
export function estimateChatCredits(
  modelId: ChatModelId,
  field: PricingFieldId
): number {
  const m = CHAT_MODEL_REGISTRY[modelId];
  const t = FIELD_TOKEN_ESTIMATES[field];
  const inCost = (t.inputTokens * m.kieInputPerM) / 1_000_000;
  const outCost = (t.outputTokens * m.kieOutputPerM) / 1_000_000;
  const kieCredits = inCost + outCost;
  return Math.max(1, Math.ceil(kieCredits * CREDIT_MARKUP));
}

/** Output-token cap for kie's `max_tokens`. Drives the determinism guarantee. */
export function outputTokenCapFor(field: PricingFieldId): number {
  return FIELD_TOKEN_ESTIMATES[field].outputTokens;
}

// ---------------------------------------------------------------------------
// Image models
// ---------------------------------------------------------------------------

export type ImageQualityId = PricingImageQualityId;

export interface ImageModelInfo {
  id: ImageQualityId;
  kieModelId: string;
  /** Family name (same across resolutions) — surfaced as the row label
   *  on the optim page, and as the provider subtitle on the
   *  Preferences page so merchants know which model is doing the work. */
  modelName: string;
  provider: 'OpenAI';
  displayName: string;
  resolution: '1K' | '2K' | '4K';
  tier: 'budget' | 'balanced' | 'premium';
  kieCost: number;
  tagline: string;
}

const IMAGE_QUALITY_META: Record<
  ImageQualityId,
  Omit<ImageModelInfo, 'id' | 'kieCost'>
> = {
  'image-1k': {
    kieModelId: 'gpt-image-2-image-to-image',
    modelName: 'GPT-Image 2',
    provider: 'OpenAI',
    displayName: '1K · Standard',
    resolution: '1K',
    tier: 'budget',
    tagline: 'Fast and crisp — fine for thumbnails and listings.'
  },
  'image-2k': {
    kieModelId: 'gpt-image-2-image-to-image',
    modelName: 'GPT-Image 2',
    provider: 'OpenAI',
    displayName: '2K · High',
    resolution: '2K',
    tier: 'balanced',
    tagline: 'Sharp lifestyle shots — recommended for hero images.'
  },
  'image-4k': {
    kieModelId: 'gpt-image-2-image-to-image',
    modelName: 'GPT-Image 2',
    provider: 'OpenAI',
    displayName: '4K · Premium',
    resolution: '4K',
    tier: 'premium',
    tagline: 'Print-grade quality — agencies and luxury brands.'
  }
};

export const IMAGE_MODEL_REGISTRY: Record<ImageQualityId, ImageModelInfo> =
  Object.fromEntries(
    IMAGE_QUALITY_IDS.map((id) => [
      id,
      {
        id,
        ...IMAGE_QUALITY_META[id],
        kieCost: PRICING.imageQualities[id].kieCost
      } satisfies ImageModelInfo
    ])
  ) as Record<ImageQualityId, ImageModelInfo>;

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

export const IMAGE_ANGLES_PER_GEN = PRICING.imageAnglesPerGen;

// ---------------------------------------------------------------------------
// Subscription tiers
// ---------------------------------------------------------------------------

export type PlanId = PricingPlanId;
export type BillingCycle = 'monthly' | 'yearly';

/** Yearly subscriptions get a -20% discount vs 12× the monthly price. */
export const YEARLY_DISCOUNT = 0.2;

export interface PlanTier {
  id: PlanId;
  name: string;
  /** Monthly retail price in EUR. Yearly price = monthly × 12 × (1 - YEARLY_DISCOUNT). */
  priceEur: number;
  /** Monthly credits granted. For `free` this is a one-shot signup grant. */
  credits: number;
  recurring: boolean;
  /** Approximate full-product generations a typical user can run on this plan. */
  approxFullGenerations: number;
  /** Max number of distinct stores (projects) the user can audit on this plan. */
  siteLimit: number;
  /** Per-plan marketing bullets, identified by stable keys. The client
   *  resolves these to translated strings via next-intl in PricingCards
   *  (`Pricing.highlightExtras.{key}`). Stored as identifiers — never as
   *  raw English copy — so no string ends up displayed unlocalized. */
  highlightExtras: PlanHighlightExtraId[];
}

/** Stable identifiers for per-plan marketing bullets. New ids must be
 *  paired with a translation key under `Pricing.highlightExtras` in
 *  every locale file. */
export const PLAN_HIGHLIGHT_EXTRAS = [
  'allModels',
  'noCard',
  'emailSupport',
  'priorityGen',
  'prioritySupport',
  'bulkOps',
  'dedicatedSuccess'
] as const;
export type PlanHighlightExtraId = (typeof PLAN_HIGHLIGHT_EXTRAS)[number];

const PLAN_DISPLAY: Record<PlanId, { name: string; highlightExtras: PlanHighlightExtraId[] }> = {
  free: {
    name: 'Free',
    highlightExtras: ['allModels', 'noCard']
  },
  starter: {
    name: 'Starter',
    highlightExtras: ['allModels', 'emailSupport']
  },
  pro: {
    name: 'Pro',
    highlightExtras: ['priorityGen', 'prioritySupport']
  },
  scale: {
    name: 'Scale',
    highlightExtras: ['bulkOps', 'dedicatedSuccess']
  }
};

/**
 * One full-product run = title + description + tags + 3 lifestyle images,
 * using the default chat model (Sonnet) and 1K image quality. Used to
 * advertise "~N product generations" on the pricing page.
 */
function fullGenerationCost(): number {
  const text =
    estimateChatCredits(DEFAULT_CHAT_MODEL, 'title') +
    estimateChatCredits(DEFAULT_CHAT_MODEL, 'description') +
    estimateChatCredits(DEFAULT_CHAT_MODEL, 'tags');
  const images = costForImage(DEFAULT_IMAGE_QUALITY) * IMAGE_ANGLES_PER_GEN;
  return text + images;
}

const FULL_GEN_COST = fullGenerationCost();

export const PLAN_TIERS: PlanTier[] = PLAN_IDS.map((id) => {
  const p = PRICING.plans[id];
  const fullGens = p.credits > 0 ? Math.floor(p.credits / FULL_GEN_COST) : 0;
  return {
    id,
    name: PLAN_DISPLAY[id].name,
    priceEur: p.priceEur,
    credits: p.credits,
    recurring: p.recurring,
    approxFullGenerations: fullGens,
    siteLimit: p.siteLimit,
    highlightExtras: PLAN_DISPLAY[id].highlightExtras
  };
});

/** Resolve the site quota for a plan id. Falls back to the free tier limit. */
export function siteLimitForPlan(plan: string | null | undefined): number {
  const tier = PLAN_TIERS.find((p) => p.id === plan);
  return tier?.siteLimit ?? PLAN_TIERS[0].siteLimit;
}

export function yearlyPriceEur(monthlyPriceEur: number): number {
  return Math.round(monthlyPriceEur * 12 * (1 - YEARLY_DISCOUNT) * 100) / 100;
}

/** Monthly-equivalent display price for a yearly cycle. */
export function yearlyMonthlyEquivalent(monthlyPriceEur: number): number {
  return Math.round(monthlyPriceEur * (1 - YEARLY_DISCOUNT) * 100) / 100;
}

export const SIGNUP_FREE_CREDITS = PLAN_TIERS[0].credits;

// ---------------------------------------------------------------------------
// Credit packs (one-time top-ups)
// ---------------------------------------------------------------------------

export type CreditPackId = PricingCreditPackId;

export interface CreditPack {
  id: CreditPackId;
  /** Marketing label. Stable, used in i18n keys. */
  name: string;
  credits: number;
  priceEur: number;
}

const PACK_DISPLAY: Record<CreditPackId, { name: string }> = {
  boost: { name: 'Boost' },
  power: { name: 'Power' },
  mega: { name: 'Mega' }
};

export const CREDIT_PACKS: CreditPack[] = CREDIT_PACK_IDS.map((id) => ({
  id,
  name: PACK_DISPLAY[id].name,
  credits: PRICING.creditPacks[id].credits,
  priceEur: PRICING.creditPacks[id].priceEur
}));

export function getCreditPack(id: string | null | undefined): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}
