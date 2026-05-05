import { z } from 'zod';
import pricingJson from '../../../pricing.json';

/**
 * Centralised pricing config. Lives in `pricing.json` at the repo root and
 * is loaded + validated once at module init. Changes don't require a rebuild
 * — just a process restart (pm2 restart oneshoplab-web).
 *
 * Anything numeric and tunable goes here. Stable identifiers (kieModelId,
 * displayName, provider, tagline) stay in models.ts because they're code-y
 * metadata, not business levers.
 */

const PositiveInt = z.number().int().positive();
const NonNegInt = z.number().int().nonnegative();
const PositiveNum = z.number().positive();

const PlanSchema = z.object({
  credits: NonNegInt,
  siteLimit: PositiveInt,
  priceEur: z.number().nonnegative(),
  recurring: z.boolean()
});

const FieldCapSchema = z.object({
  inputTokens: PositiveInt,
  outputTokens: PositiveInt
});

const ChatModelSchema = z.object({
  kieInputPerM: PositiveNum,
  kieOutputPerM: PositiveNum
});

const ImageQualitySchema = z.object({
  kieCost: PositiveNum
});

const CreditPackSchema = z.object({
  credits: PositiveInt,
  priceEur: z.number().positive()
});

export const PLAN_IDS = ['free', 'starter', 'pro', 'scale'] as const;
export type PricingPlanId = (typeof PLAN_IDS)[number];

export const CHAT_MODEL_IDS = ['gemini-3-1-pro', 'sonnet-4-6', 'opus-4-6'] as const;
export type PricingChatModelId = (typeof CHAT_MODEL_IDS)[number];

export const IMAGE_QUALITY_IDS = ['image-1k', 'image-2k', 'image-4k'] as const;
export type PricingImageQualityId = (typeof IMAGE_QUALITY_IDS)[number];

export const FIELD_IDS = ['title', 'description', 'tags', 'social', 'fullAudit'] as const;
export type PricingFieldId = (typeof FIELD_IDS)[number];

export const CREDIT_PACK_IDS = ['boost', 'power', 'mega'] as const;
export type CreditPackId = (typeof CREDIT_PACK_IDS)[number];

const PricingSchema = z.object({
  creditMarkupFactor: z.number().min(1).max(10),
  creditUsdValue: PositiveNum,
  kieCreditUsdValue: PositiveNum,
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
  imageQualities: z.object(
    Object.fromEntries(IMAGE_QUALITY_IDS.map((id) => [id, ImageQualitySchema])) as Record<
      PricingImageQualityId,
      typeof ImageQualitySchema
    >
  ),
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
  // markup without rewriting the JSON. Server-only — process.env is empty in
  // the client bundle so the override is silently ignored there (which is
  // fine because the same numbers were already inlined at build time).
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
