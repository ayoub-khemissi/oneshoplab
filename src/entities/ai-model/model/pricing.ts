import { z } from 'zod';
import pricingJson from '../../../../pricing.json';

/**
 * Centralised AI catalog + pricing config. Lives in `pricing.json` at the
 * repo root and is loaded + validated once at module init.
 *
 * pricing.json is the SINGLE place to edit when a model changes: upstream
 * ids (OpenRouter primary, kie fallback), display names, tiers, taglines,
 * retail rates, markups, the default model and the image fallback model.
 * Everything else (credit debits, the model picker, the marketing copy
 * placeholders) derives from it through models.ts. Rebuild + restart
 * web and worker after editing (the JSON is bundled at build time).
 *
 * Rates are the provider's USD per 1M tokens expressed in units of
 * `providerUnitUsd` (0.005 $) so a $2/M model reads as 400 — the unit kie
 * historically billed in, kept so historical rows stay comparable.
 */

const PositiveInt = z.number().int().positive();
const NonNegInt = z.number().int().nonnegative();
const PositiveNum = z.number().positive();

const PlanSchema = z.object({
  credits: NonNegInt,
  siteLimit: PositiveInt,
  /** Max products a site may hold through the Integration API (spec §3 `plan_limit`). */
  productLimit: PositiveInt,
  priceEur: z.number().nonnegative(),
  recurring: z.boolean()
});

const FieldCapSchema = z.object({
  inputTokens: PositiveInt,
  outputTokens: PositiveInt
});

const TierSchema = z.enum(['budget', 'balanced', 'premium']);
const ProviderSchema = z.enum(['Anthropic', 'Google', 'OpenAI']);

const ChatModelSchema = z.object({
  displayName: z.string().min(1),
  provider: ProviderSchema,
  tier: TierSchema,
  tagline: z.string().min(1),
  /** Model id on OpenRouter (primary text provider). */
  openrouterId: z.string().min(1),
  /** Model id on kie.ai (fallback text provider). */
  kieModelId: z.string().min(1),
  /** Accepts `image` content blocks. Only a vision model can be asked for
   *  alt text; a non-vision pick is swapped for one (see visionChatModel). */
  vision: z.boolean(),
  inputPerM: PositiveNum,
  outputPerM: PositiveNum
});

const ModelRefSchema = z.object({
  openrouterId: z.string().min(1),
  kieModelId: z.string().min(1)
});

const ImageQualitySchema = z.object({
  displayName: z.string().min(1),
  resolution: z.enum(['1K', '2K', '4K']),
  tier: TierSchema,
  tagline: z.string().min(1),
  /** Flat provider cost per image, in provider units. */
  cost: PositiveNum
});

const CreditPackSchema = z.object({
  credits: PositiveInt,
  priceEur: z.number().positive()
});

export const PLAN_IDS = ['free', 'starter', 'pro', 'scale'] as const;
export type PricingPlanId = (typeof PLAN_IDS)[number];

export const CHAT_MODEL_IDS = ['haiku-4-5', 'sonnet-5', 'opus-5'] as const;
export type PricingChatModelId = (typeof CHAT_MODEL_IDS)[number];

export const SYSTEM_CHAT_ROLES = ['fast'] as const;
export type SystemChatRole = (typeof SYSTEM_CHAT_ROLES)[number];

export const IMAGE_QUALITY_IDS = ['image-1k', 'image-2k', 'image-4k'] as const;
export type PricingImageQualityId = (typeof IMAGE_QUALITY_IDS)[number];

export const FIELD_IDS = [
  'title',
  'description',
  'tags',
  'alt',
  'suggest',
  'social',
  'fullAudit'
] as const;
export type PricingFieldId = (typeof FIELD_IDS)[number];

export const CREDIT_PACK_IDS = ['boost', 'power', 'mega'] as const;
export type CreditPackId = (typeof CREDIT_PACK_IDS)[number];

const PricingSchema = z.object({
  _comment: z.string().optional(),
  creditMarkupFactor: z.number().min(1).max(10),
  /** Markup for text generations; images keep creditMarkupFactor. */
  chatMarkupFactor: z.number().min(1).max(10),
  creditUsdValue: PositiveNum,
  providerUnitUsd: PositiveNum,
  imageAnglesPerGen: PositiveInt,
  plans: z.object(
    Object.fromEntries(PLAN_IDS.map((id) => [id, PlanSchema])) as Record<
      PricingPlanId,
      typeof PlanSchema
    >
  ),
  fieldCaps: z.object(
    Object.fromEntries(FIELD_IDS.map((id) => [id, FieldCapSchema])) as Record<
      PricingFieldId,
      typeof FieldCapSchema
    >
  ),
  chatModels: z.object(
    Object.fromEntries(CHAT_MODEL_IDS.map((id) => [id, ChatModelSchema])) as Record<
      PricingChatModelId,
      typeof ChatModelSchema
    >
  ),
  defaultChatModel: z.enum(CHAT_MODEL_IDS),
  /** Retired ids (still stored in old prefs / job payloads) → current id. */
  chatModelAliases: z.record(z.string(), z.enum(CHAT_MODEL_IDS)),
  /** Models the app uses internally (prompt suggestions) — not
   *  user-selectable, not debited through estimateChatCredits. */
  systemChatModels: z.object(
    Object.fromEntries(SYSTEM_CHAT_ROLES.map((r) => [r, ModelRefSchema])) as Record<
      SystemChatRole,
      typeof ModelRefSchema
    >
  ),
  imageModel: z.object({
    modelName: z.string().min(1),
    provider: ProviderSchema,
    kieModelId: z.string().min(1)
  }),
  imageQualities: z.object(
    Object.fromEntries(IMAGE_QUALITY_IDS.map((id) => [id, ImageQualitySchema])) as Record<
      PricingImageQualityId,
      typeof ImageQualitySchema
    >
  ),
  defaultImageQuality: z.enum(IMAGE_QUALITY_IDS),
  /** Used when the primary image provider fails (kie), via OpenRouter. */
  imageFallbackModel: z.object({
    displayName: z.string().min(1),
    provider: ProviderSchema,
    openrouterId: z.string().min(1)
  }),
  creditPacks: z.object(
    Object.fromEntries(CREDIT_PACK_IDS.map((id) => [id, CreditPackSchema])) as Record<
      CreditPackId,
      typeof CreditPackSchema
    >
  )
});

export type PricingConfig = z.infer<typeof PricingSchema>;

function load(): PricingConfig {
  const parsed = PricingSchema.safeParse(pricingJson);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[pricing] pricing.json failed validation:\n${issues}`);
  }

  const config = parsed.data;

  // Tolerate a CREDIT_MARKUP_FACTOR env override so we can A/B-test the
  // image markup without rewriting the JSON. Server-only — process.env is
  // empty in the client bundle so the override is silently ignored there
  // (which is fine because the same numbers were already inlined at build).
  const markupOverride =
    typeof process !== 'undefined'
      ? Number.parseFloat(process.env.CREDIT_MARKUP_FACTOR ?? '')
      : NaN;
  if (Number.isFinite(markupOverride) && markupOverride >= 1 && markupOverride <= 10) {
    return { ...config, creditMarkupFactor: markupOverride };
  }
  return config;
}

export const PRICING: PricingConfig = load();
