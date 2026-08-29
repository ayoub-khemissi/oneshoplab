/**
 * Model registry — static identifiers + display copy for the LLMs and image
 * models we expose to merchants. All numeric levers (kie rates, markup,
 * caps, plan credits, credit-pack pricing) live in `pricing.json` and are
 * loaded via `./pricing`. This file only owns:
 *   - kieModelId  (the string passed to kie's API — stable, code-y)
 *   - displayName / provider / tier / tagline (UI copy)
 *   - the merge function that combines static metadata with JSON numbers
 *
 * Pricing math: every chat field has an "expected" input/output token
 * budget in pricing.json's fieldCaps. The cost shown to the user is
 * cap × kie-rate × markup, debited atomically — the user is never
 * surprise-billed.
 *
 * runChatOptim sends max_tokens = outputCap × SAFETY_MULTIPLIER to kie
 * (currently 2.5×) so the model has room to honor the prompt's length
 * instruction without getting cut mid-sentence. The pricing cap stays
 * the budgeting basis; the safety cap is just a fallback to bound
 * runaway generations. Margins hold (~35% Opus, ~50% Sonnet) even
 * when a verbose run hits the safety cap.
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
  type PricingPlanId,
  type SystemChatRole
} from './pricing';

/** Markup applied to image generations (provider cost × markup). */
export const CREDIT_MARKUP = PRICING.creditMarkupFactor;
/** Markup applied to text generations — text is cheap, so a lower
 *  multiplier keeps the per-product price stable across provider moves. */
export const CHAT_MARKUP = PRICING.chatMarkupFactor;
export const CREDIT_USD_VALUE = PRICING.creditUsdValue;
/** USD value of one provider unit (the unit `inputPerM` / `cost` are in). */
export const PROVIDER_UNIT_USD = PRICING.providerUnitUsd;

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
/**
 * Per-plan retention period for AI-generated images on R2 storage.
 * Free / Starter keep the original 30-day window; Pro doubles it,
 * Scale triples. The cleanup worker reads each job's project owner's
 * plan and applies the matching TTL — so a downgrade shortens the
 * window naturally and an upgrade extends it for any image still
 * within the new ceiling.
 */
const IMAGE_RETENTION_DAYS_BY_PLAN: Record<PricingPlanId, number> = {
  free: 30,
  starter: 30,
  pro: 60,
  scale: 90
};

export function imageRetentionDaysForPlan(plan: PricingPlanId | string | null | undefined): number {
  const safe = (plan && plan in IMAGE_RETENTION_DAYS_BY_PLAN ? plan : 'free') as PricingPlanId;
  return IMAGE_RETENTION_DAYS_BY_PLAN[safe];
}

/** Highest retention period across all plans. Acts as a hard upper
 *  bound when the cleanup worker can't resolve the owning plan. */
export const MAX_IMAGE_RETENTION_DAYS = Math.max(
  ...Object.values(IMAGE_RETENTION_DAYS_BY_PLAN)
);

/** @deprecated Use imageRetentionDaysForPlan() — kept as the free-tier
 *  default for any non-plan-aware callers we haven't migrated. */
export const IMAGE_RETENTION_DAYS = IMAGE_RETENTION_DAYS_BY_PLAN.free;

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

/** Where a chat model lives on each provider. OpenRouter is the primary
 *  text provider; kie is the fallback when OpenRouter errors. */
export interface ChatModelRef {
  openrouterId: string;
  kieModelId: string;
}

export interface ChatModelInfo extends ChatModelRef {
  id: ChatModelId;
  displayName: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google';
  tier: 'budget' | 'balanced' | 'premium';
  /** Provider rates per million tokens, in provider units (see pricing.json). */
  inputPerM: number;
  outputPerM: number;
  /** Short pitch shown in the model selector. */
  tagline: string;
}

export const CHAT_MODEL_REGISTRY: Record<ChatModelId, ChatModelInfo> =
  Object.fromEntries(
    CHAT_MODEL_IDS.map((id) => [id, { id, ...PRICING.chatModels[id] } satisfies ChatModelInfo])
  ) as Record<ChatModelId, ChatModelInfo>;

export const DEFAULT_CHAT_MODEL: ChatModelId = PRICING.defaultChatModel;

/** Map a stored id (possibly a retired one, e.g. 'sonnet-4-6' in an old
 *  preference or job payload) to a current catalog id. Unknown → default. */
export function resolveChatModelId(id: string | null | undefined): ChatModelId {
  if (!id) return DEFAULT_CHAT_MODEL;
  if (id in CHAT_MODEL_REGISTRY) return id as ChatModelId;
  const alias = PRICING.chatModelAliases[id];
  return alias ?? DEFAULT_CHAT_MODEL;
}

export function getChatModel(id: ChatModelId | string | null | undefined): ChatModelInfo {
  return CHAT_MODEL_REGISTRY[resolveChatModelId(id)];
}

/** Internal (non user-selectable) models: 'fast' for prompt suggestions,
 *  'quality' for the dynamic audit / structured rewrites. */
export const SYSTEM_CHAT_MODELS: Record<SystemChatRole, ChatModelRef> = PRICING.systemChatModels;

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
 * cap (input + output) × the provider's per-million rate × CHAT_MARKUP, ceilinged to an
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
  const inCost = (t.inputTokens * m.inputPerM) / 1_000_000;
  const outCost = (t.outputTokens * m.outputPerM) / 1_000_000;
  const providerUnits = inCost + outCost;
  return Math.max(1, Math.ceil(providerUnits * CHAT_MARKUP));
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
  provider: 'OpenAI' | 'Anthropic' | 'Google';
  displayName: string;
  resolution: '1K' | '2K' | '4K';
  tier: 'budget' | 'balanced' | 'premium';
  /** Flat provider cost per image, in provider units. */
  kieCost: number;
  tagline: string;
}

/** The image family behind every quality tier (kie, primary). */
export const IMAGE_MODEL = PRICING.imageModel;
/** Used by the worker when kie fails mid-flight (OpenRouter). */
export const IMAGE_FALLBACK_MODEL = PRICING.imageFallbackModel;

export const IMAGE_MODEL_REGISTRY: Record<ImageQualityId, ImageModelInfo> =
  Object.fromEntries(
    IMAGE_QUALITY_IDS.map((id) => {
      const q = PRICING.imageQualities[id];
      return [
        id,
        {
          id,
          kieModelId: IMAGE_MODEL.kieModelId,
          modelName: IMAGE_MODEL.modelName,
          provider: IMAGE_MODEL.provider,
          displayName: q.displayName,
          resolution: q.resolution,
          tier: q.tier,
          kieCost: q.cost,
          tagline: q.tagline
        } satisfies ImageModelInfo
      ];
    })
  ) as Record<ImageQualityId, ImageModelInfo>;

export const DEFAULT_IMAGE_QUALITY: ImageQualityId = PRICING.defaultImageQuality;

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

/** Stable identifiers for per-plan marketing bullets. Each id MUST
 *  correspond to a real, shipped feature — we don't list aspirational
 *  copy. Any addition here pairs with a translation key under
 *  `Pricing.highlightExtras` in every locale and an actual code path
 *  in the app. */
export const PLAN_HIGHLIGHT_EXTRAS = ['allModels', 'noCard', 'bulkOps'] as const;
export type PlanHighlightExtraId = (typeof PLAN_HIGHLIGHT_EXTRAS)[number];

const PLAN_DISPLAY: Record<PlanId, { name: string; highlightExtras: PlanHighlightExtraId[] }> = {
  free: {
    name: 'Free',
    highlightExtras: ['allModels', 'noCard']
  },
  starter: {
    name: 'Starter',
    highlightExtras: ['allModels']
  },
  pro: {
    name: 'Pro',
    highlightExtras: ['allModels', 'bulkOps']
  },
  scale: {
    name: 'Scale',
    highlightExtras: ['allModels', 'bulkOps']
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

// ---------------------------------------------------------------------------
// Names for marketing copy
// ---------------------------------------------------------------------------

/**
 * Placeholder values for the i18n strings that mention models (home
 * onboarding, pricing explainer, FAQ). The copy in messages/*.json says
 * `{budgetModel}` etc. so swapping a model in pricing.json updates all 13
 * locales at once instead of 39 hand edits.
 */
export function modelNamesForCopy(): Record<
  | 'budgetModel'
  | 'balancedModel'
  | 'premiumModel'
  | 'defaultModel'
  | 'imageModel'
  | 'budgetProvider'
  | 'balancedProvider'
  | 'premiumProvider'
  | 'imageProvider'
  | 'aiGateways'
  | 'aiProviders',
  string
> {
  const fallback = CHAT_MODEL_REGISTRY[DEFAULT_CHAT_MODEL];
  const byTier = (tier: ChatModelInfo['tier']) =>
    Object.values(CHAT_MODEL_REGISTRY).find((m) => m.tier === tier) ?? fallback;
  const budget = byTier('budget');
  const balanced = byTier('balanced');
  const premium = byTier('premium');
  return {
    ...aiProviderNamesForCopy(),
    budgetModel: budget.displayName,
    balancedModel: balanced.displayName,
    premiumModel: premium.displayName,
    defaultModel: fallback.displayName,
    imageModel: IMAGE_MODEL.modelName,
    budgetProvider: budget.provider,
    // The copy groups balanced + premium under one provider name
    // ("… or Sonnet / Opus by Anthropic"); premiumProvider is exposed
    // for strings that want to name it separately.
    balancedProvider: balanced.provider,
    premiumProvider: premium.provider,
    imageProvider: IMAGE_MODEL.provider
  };
}

// ---------------------------------------------------------------------------
// AI sub-processors (legal pages + FAQ), derived from the catalog
// ---------------------------------------------------------------------------

export interface AiSubProcessor {
  /** Legal entity name as it should appear in the privacy policy. */
  entity: string;
  /** What it does for us, in plain English (legal pages are English-only). */
  role: string;
  location: string;
}

/** Static legal facts per model provider; the ROLE is derived from how the
 *  catalog actually uses them, so the legal pages follow provider swaps. */
const PROVIDER_LEGAL: Record<ChatModelInfo['provider'], { entity: string; location: string }> = {
  Anthropic: { entity: 'Anthropic, PBC', location: 'USA' },
  OpenAI: { entity: 'OpenAI, L.L.C.', location: 'USA' },
  Google: { entity: 'Google LLC', location: 'USA / EU' }
};

const GATEWAY_OPENROUTER = { entity: 'OpenRouter, Inc.', location: 'USA' };
const GATEWAY_KIE = { entity: 'kie.ai', location: 'USA' };

/**
 * The AI gateways and model providers currently in use, with their roles.
 * OpenRouter is the primary text gateway (and hosts the image fallback);
 * kie.ai is the primary image gateway (and the text fallback). Model
 * providers are read from pricing.json so a catalog change updates the
 * Terms, the Privacy sub-processor table and the FAQ in one move.
 */
export function aiSubProcessors(): AiSubProcessor[] {
  const chatProviders = [...new Set(Object.values(CHAT_MODEL_REGISTRY).map((m) => m.provider))];
  const imageProvider = IMAGE_MODEL.provider;
  const fallbackProvider = IMAGE_FALLBACK_MODEL.provider;
  const rows: AiSubProcessor[] = [
    {
      ...GATEWAY_OPENROUTER,
      role: 'AI gateway routing text-generation prompts to model providers (primary), and hosting the image-generation fallback model'
    },
    {
      ...GATEWAY_KIE,
      role: 'AI gateway for image generation (primary), and text-generation fallback'
    }
  ];
  const providerRoles = new Map<ChatModelInfo['provider'], string[]>();
  const add = (p: ChatModelInfo['provider'], role: string) =>
    providerRoles.set(p, [...(providerRoles.get(p) ?? []), role]);
  for (const p of chatProviders) {
    const names = [...new Set(Object.values(CHAT_MODEL_REGISTRY).filter((m) => m.provider === p).map((m) => m.displayName))];
    add(p, `${names.join(', ')} (text generation), via OpenRouter / kie.ai`);
  }
  add(imageProvider, `${IMAGE_MODEL.modelName} (image generation), via kie.ai`);
  add(fallbackProvider, `${IMAGE_FALLBACK_MODEL.displayName} (image generation fallback), via OpenRouter`);
  for (const [p, roles] of providerRoles) {
    rows.push({ ...PROVIDER_LEGAL[p], role: roles.join('; ') });
  }
  return rows;
}

/** Short strings for i18n placeholders: "{aiGateways}" / "{aiProviders}". */
export function aiProviderNamesForCopy(): { aiGateways: string; aiProviders: string } {
  const providers = [
    ...new Set([
      ...Object.values(CHAT_MODEL_REGISTRY).map((m) => m.provider),
      IMAGE_MODEL.provider,
      IMAGE_FALLBACK_MODEL.provider
    ])
  ];
  return { aiGateways: 'OpenRouter / kie.ai', aiProviders: providers.join(' / ') };
}
