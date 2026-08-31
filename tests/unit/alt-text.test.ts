/**
 * Alt-text generation, the pure half: the prompt that carries the image, the
 * sanitising of what comes back, the price of one alt, and the rule that a
 * blind model never gets asked to describe a photo.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAT_MODEL_IDS,
  CHAT_MODEL_REGISTRY,
  estimateChatCredits,
  pickVisionModel,
  systemChatModel,
  visionChatModel,
  type ChatModelInfo
} from '@/entities/ai-model';
import {
  ALT_TEXT_MAX_CHARS,
  buildAltTextPrompt,
  sanitizeAltText,
  type ProductContext
} from '@/entities/generation-job/lib/prompts';

const product: ProductContext = {
  title: 'Hand-thrown stoneware mug',
  descriptionText: 'A mug.',
  vendor: 'Atelier Terre',
  productType: 'Mugs',
  tags: ['stoneware', 'handmade', 'kitchen'],
  imageCount: 3,
  priceMin: 24,
  priceMax: 24,
  currency: 'EUR'
};

describe('buildAltTextPrompt', () => {
  const built = buildAltTextPrompt(product, 'https://cdn.test/mug.jpg', 'French');

  it('sends the image as a content block the provider layer understands', () => {
    expect(Array.isArray(built.user)).toBe(true);
    expect(built.user[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://cdn.test/mug.jpg' }
    });
    // The image comes FIRST: the instruction that follows refers to "the photo
    // above", and models weigh the last block most.
    expect(built.user[1].type).toBe('text');
  });

  it('carries the product context in the text block, not the title alone', () => {
    const text = built.user[1].type === 'text' ? built.user[1].text : '';
    expect(text).toContain('Hand-thrown stoneware mug');
    expect(text).toContain('Mugs');
    expect(text).toContain('Atelier Terre');
    expect(text).toContain('stoneware, handmade, kitchen');
  });

  it('states the length cap, the forbidden openings and the language', () => {
    expect(built.system).toContain(String(ALT_TEXT_MAX_CHARS));
    expect(built.system).toMatch(/photo of/i);
    expect(built.system).toMatch(/image of/i);
    expect(built.system).toMatch(/keyword stuffing/i);
    expect(built.system).toMatch(/no quotes/i);
    expect(built.system).toContain('French');
  });

  it('never leaves a null in the prompt when the product has no metadata', () => {
    const bare = buildAltTextPrompt(
      { ...product, vendor: null, productType: null, tags: [] },
      'https://cdn.test/x.jpg',
      'English'
    );
    const text = bare.user[1].type === 'text' ? bare.user[1].text : '';
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('Existing tags');
  });
});

describe('sanitizeAltText', () => {
  it('keeps a clean sentence untouched', () => {
    expect(sanitizeAltText('Mug en grès posé sur une table en bois')).toBe(
      'Mug en grès posé sur une table en bois'
    );
  });

  it('strips the wrappers models add despite the prompt', () => {
    expect(sanitizeAltText('"Mug en grès sur une table"')).toBe('Mug en grès sur une table');
    expect(sanitizeAltText('« Mug en grès »')).toBe('Mug en grès');
    expect(sanitizeAltText('**Mug en grès**')).toBe('Mug en grès');
    expect(sanitizeAltText('Alt: Mug en grès')).toBe('Mug en grès');
    expect(sanitizeAltText('Texte alternatif : Mug en grès')).toBe('Mug en grès');
    expect(sanitizeAltText('Mug en grès.')).toBe('Mug en grès');
  });

  it('keeps the first line when the model adds commentary', () => {
    expect(sanitizeAltText('Mug en grès sur une table\n\nJ’espère que cela convient !')).toBe(
      'Mug en grès sur une table'
    );
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeAltText('   Mug   en    grès   ')).toBe('Mug en grès');
  });

  it('truncates on a word boundary, never mid-word', () => {
    const long = `${'Mug en grès posé sur une table en bois clair '.repeat(6)}fin`;
    const out = sanitizeAltText(long);
    expect(out.length).toBeLessThanOrEqual(ALT_TEXT_MAX_CHARS);
    expect(long.startsWith(out)).toBe(true);
    expect(out.endsWith(' ')).toBe(false);
    // A word was cut, not a letter: the last kept token is complete.
    expect(long[out.length]).toMatch(/\s/);
  });

  it('returns an empty string for an empty completion rather than a quote', () => {
    expect(sanitizeAltText('   ')).toBe('');
    expect(sanitizeAltText('""')).toBe('');
  });
});

describe('alt credits', () => {
  it('costs a single credit on the fast system model', () => {
    // The fast system model is what runAltTextOptim uses by default; one alt
    // text must stay a rounding error next to a 21-credit image.
    expect(estimateChatCredits(systemChatModel('fast').id, 'alt')).toBe(1);
  });

  it('is the cheapest field on every model', () => {
    for (const id of CHAT_MODEL_IDS) {
      const alt = estimateChatCredits(id, 'alt');
      expect(alt, id).toBeGreaterThan(0);
      expect(alt, id).toBeLessThanOrEqual(estimateChatCredits(id, 'title'));
      expect(alt, id).toBeLessThan(estimateChatCredits(id, 'description'));
    }
  });
});

describe('vision-capable model selection', () => {
  const seeing = (id: string, inputPerM: number, vision: boolean): ChatModelInfo => ({
    id: id as ChatModelInfo['id'],
    displayName: id,
    provider: 'Anthropic',
    tier: 'balanced',
    vision,
    openrouterId: `x/${id}`,
    kieModelId: id,
    inputPerM,
    outputPerM: inputPerM * 5,
    tagline: ''
  });

  it('keeps the caller pick when it can read images', () => {
    const pick = seeing('sees', 400, true);
    expect(pickVisionModel(pick, [pick, seeing('other', 100, true)])).toBe(pick);
  });

  it('falls back to the cheapest vision model when the pick is blind', () => {
    const blind = seeing('blind', 50, false);
    const cheap = seeing('cheap', 200, true);
    const dear = seeing('dear', 1000, true);
    expect(pickVisionModel(blind, [blind, dear, cheap])).toBe(cheap);
  });

  it('answers null rather than sending an image to a blind model', () => {
    const blind = seeing('blind', 50, false);
    expect(pickVisionModel(blind, [blind])).toBeNull();
  });

  it('every catalog model resolves to a vision model', () => {
    for (const id of CHAT_MODEL_IDS) {
      expect(visionChatModel(id).vision, id).toBe(true);
    }
    expect(visionChatModel().vision).toBe(true);
    expect(visionChatModel(null).id).toBe(systemChatModel('fast').id);
  });

  it('the catalog declares vision on every entry', () => {
    for (const id of CHAT_MODEL_IDS) {
      expect(typeof CHAT_MODEL_REGISTRY[id].vision, id).toBe('boolean');
    }
  });
});
