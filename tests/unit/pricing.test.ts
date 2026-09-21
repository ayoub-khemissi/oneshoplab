/**
 * pricing.json is the single source of truth for models, rates and credit
 * costs. These tests pin what customers are charged: a change to any credit
 * cost must show up as a deliberate snapshot update in the same PR.
 */
import { describe, expect, it } from 'vitest';
import {
  bestValuePack,
  catalogCredits,
  CHAT_MODEL_REGISTRY,
  costForImage,
  CUSTOM_QUOTE_THRESHOLDS,
  FULL_GENERATION_CREDITS,
  packPerCreditEur,
  recommendPlanForCatalog,
  DEFAULT_CHAT_MODEL,
  estimateChatCredits,
  getCreditPack,
  getImageModel,
  IMAGE_MODEL_REGISTRY,
  PLAN_TIERS,
  resolveChatModelId,
  SYSTEM_CHAT_MODELS,
  YEARLY_DISCOUNT,
  yearlyMonthlyEquivalent,
  yearlyPriceEur
} from '@/entities/ai-model';
import {
  CHAT_MODEL_IDS,
  CREDIT_PACK_IDS,
  FIELD_IDS,
  IMAGE_QUALITY_IDS,
  PRICING
} from '@/entities/ai-model';
import { CHAT_MODEL_IDS as DB_CHAT_MODEL_IDS } from '@/shared/db/schema';

describe('credit costs (snapshot — update deliberately)', () => {
  it('text generation per model × field', () => {
    const table = Object.fromEntries(
      CHAT_MODEL_IDS.map((m) => [
        m,
        Object.fromEntries(FIELD_IDS.map((f) => [f, estimateChatCredits(m, f)]))
      ])
    );
    expect(table).toMatchSnapshot();
  });

  it('image generation per quality', () => {
    expect(
      Object.fromEntries(IMAGE_QUALITY_IDS.map((q) => [q, costForImage(q)]))
    ).toMatchSnapshot();
  });

  it('plans and packs', () => {
    expect(
      PLAN_TIERS.map((p) => ({ id: p.id, credits: p.credits, monthlyEur: p.priceEur }))
    ).toMatchSnapshot();
    expect(
      CREDIT_PACK_IDS.map((id) => {
        const p = getCreditPack(id)!;
        return { id, credits: p.credits, price: p.priceEur };
      })
    ).toMatchSnapshot();
  });
});

describe('catalog invariants', () => {
  it('every chat model has both upstream ids and a positive cost', () => {
    for (const id of CHAT_MODEL_IDS) {
      const m = CHAT_MODEL_REGISTRY[id];
      expect(m.openrouterId, id).toMatch(/\//);
      expect(m.kieModelId, id).toBeTruthy();
      for (const f of FIELD_IDS)
        expect(estimateChatCredits(id, f), `${id}/${f}`).toBeGreaterThan(0);
    }
  });

  it('default and system models are active catalog entries', () => {
    expect(CHAT_MODEL_IDS).toContain(DEFAULT_CHAT_MODEL);
    const known = CHAT_MODEL_IDS.map((id) => CHAT_MODEL_REGISTRY[id].openrouterId);
    for (const ref of Object.values(SYSTEM_CHAT_MODELS)) {
      expect(known).toContain(ref.openrouterId);
      expect(ref.kieModelId).toBeTruthy();
    }
  });

  it('retired ids resolve through aliases, unknown ids fall back to the default', () => {
    for (const [old, target] of Object.entries(PRICING.chatModelAliases)) {
      expect(resolveChatModelId(old)).toBe(target);
    }
    expect(resolveChatModelId('does-not-exist')).toBe(DEFAULT_CHAT_MODEL);
    expect(resolveChatModelId(null)).toBe(DEFAULT_CHAT_MODEL);
  });

  it('the MySQL enum for preferred_chat_model covers every active id and every alias', () => {
    const dbIds: readonly string[] = DB_CHAT_MODEL_IDS;
    for (const id of CHAT_MODEL_IDS) expect(dbIds, id).toContain(id);
    for (const old of Object.keys(PRICING.chatModelAliases)) expect(dbIds, old).toContain(old);
  });

  it('image qualities are ordered by cost and resolve with a fallback', () => {
    const costs = IMAGE_QUALITY_IDS.map((id) => costForImage(id));
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    expect(getImageModel('bogus').id).toBe(PRICING.defaultImageQuality);
    expect(Object.keys(IMAGE_MODEL_REGISTRY).sort()).toEqual([...IMAGE_QUALITY_IDS].sort());
  });

  it('yearly billing applies the YEARLY_DISCOUNT to 12 months, consistently for the badge', () => {
    for (const p of PLAN_TIERS) {
      if (!p.priceEur) continue;
      const yearly = yearlyPriceEur(p.priceEur);
      expect(yearly).toBeCloseTo(p.priceEur * 12 * (1 - YEARLY_DISCOUNT), 2);
      expect(yearly).toBeLessThan(p.priceEur * 12);
      expect(yearlyMonthlyEquivalent(p.priceEur)).toBeCloseTo(yearly / 12, 1);
    }
  });
});

describe('catalog simulator', () => {
  it('prices a catalog as N full generations at the defaults', () => {
    expect(catalogCredits(0)).toBe(0);
    expect(catalogCredits(10)).toBe(10 * FULL_GENERATION_CREDITS);
    expect(catalogCredits(2.9)).toBe(2 * FULL_GENERATION_CREDITS);
    expect(catalogCredits(-5)).toBe(0);
    // A plan's advertised "≈ N full generations" is exactly this unit.
    const pro = PLAN_TIERS.find((p) => p.id === 'pro')!;
    expect(pro.approxFullGenerations).toBe(Math.floor(pro.credits / FULL_GENERATION_CREDITS));
  });

  it('recommends the smallest tier that covers one full pass', () => {
    expect(recommendPlanForCatalog(1).plan).toBe('free');
    const starter = PLAN_TIERS.find((p) => p.id === 'starter')!;
    expect(recommendPlanForCatalog(starter.approxFullGenerations).plan).toBe('starter');
    expect(recommendPlanForCatalog(starter.approxFullGenerations + 1).plan).toBe('pro');
    const pro = PLAN_TIERS.find((p) => p.id === 'pro')!;
    expect(recommendPlanForCatalog(pro.approxFullGenerations + 1).plan).toBe('scale');
  });

  it('tops Scale up with the best-value pack rather than inventing a fifth tier', () => {
    const scale = PLAN_TIERS.find((p) => p.id === 'scale')!;
    const rec = recommendPlanForCatalog(scale.approxFullGenerations + 100);
    expect(rec.plan).toBe('scale');
    expect(rec.extraCredits).toBe(rec.credits - scale.credits);
    expect(rec.packs?.id).toBe(bestValuePack().id);
    expect(rec.packs!.count * bestValuePack().credits).toBeGreaterThanOrEqual(rec.extraCredits);
    expect((rec.packs!.count - 1) * bestValuePack().credits).toBeLessThan(rec.extraCredits);
  });

  it('sends catalogs past the threshold to a custom quote', () => {
    expect(CUSTOM_QUOTE_THRESHOLDS.products).toBe(1000);
    expect(recommendPlanForCatalog(1000).plan).not.toBe('custom');
    const rec = recommendPlanForCatalog(1001);
    expect(rec).toMatchObject({ plan: 'custom', extraCredits: 0, packs: null });
    expect(rec.credits).toBe(catalogCredits(1001));
  });

  it('the best-value pack really is the cheapest per credit', () => {
    const best = bestValuePack();
    for (const id of CREDIT_PACK_IDS) {
      expect(packPerCreditEur(getCreditPack(id)!)).toBeGreaterThanOrEqual(packPerCreditEur(best));
    }
  });
});
