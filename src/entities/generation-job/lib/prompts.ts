import type { ChatContentBlock } from '@/entities/ai-provider';
import type { ProductField } from '@/shared/db/schema';

export interface ProductContext {
  title: string;
  descriptionText: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageCount: number;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
}

const FIELD_BRIEFS: Record<ProductField, string> = {
  title:
    'rewrite the product TITLE in different angles (punchy, SEO-optimised, luxury, benefit-led, technical)',
  description:
    'rewrite the product DESCRIPTION in different angles (storytelling, technical specs, benefit-led, sensory, eco-conscious)',
  images:
    'generate ALTERNATE LIFESTYLE IMAGES via image-to-image — different scenes/settings while keeping the product identical (outdoor natural, indoor minimalist, in-use shot, model wearing/holding, contextual scene)',
  tags: 'suggest alternative TAG SETS for discovery (customer-search-oriented, mood-based, material/spec-based, occasion-based, demographic-based)'
};

/**
 * Build a Claude prompt asking for 5 distinct prompt suggestions tailored to
 * the field being optimised. Output spec is strict JSON so we can parse
 * reliably and surface as clickable cards in the UI.
 */
export function buildSuggestionPrompt(
  field: ProductField,
  p: ProductContext,
  languageName: string
): string {
  const brief = FIELD_BRIEFS[field];

  const priceLine =
    p.priceMin != null && p.priceMax != null
      ? `Price: ${p.priceMin}${p.priceMin === p.priceMax ? '' : `-${p.priceMax}`} ${p.currency ?? ''}`
      : '';
  const tagLine = p.tags.length > 0 ? `Existing tags: ${p.tags.slice(0, 15).join(', ')}` : '';
  const descExcerpt =
    p.descriptionText.length > 600 ? `${p.descriptionText.slice(0, 600)}…` : p.descriptionText;

  return `You are an expert e-commerce copywriter helping a merchant optimise a product page. Below is the product. Generate 5 distinct prompt suggestions a merchant could pick to ${brief}.

Product:
- Title: ${p.title}
- Vendor: ${p.vendor ?? '(none)'}
- Type: ${p.productType ?? '(none)'}
${priceLine}
${tagLine}
- Images on store: ${p.imageCount}
- Description: ${descExcerpt || '(empty)'}

Output rules:
1. Return ONLY a JSON array. No preamble, no markdown fences, no commentary.
2. Each item is an object with "tone" (a short label, max 4 words) and "prompt" (the actual prompt the merchant will hand off to the generator, written in instruction form, max 200 chars).
3. Vary tone genuinely — no two items should overlap.
4. Write the prompts in ${languageName}.

Example format (illustrative only, do not copy):
[{"tone":"Punchy","prompt":"Rewrite as a sharp 6-word title that leads with the main benefit."},{"tone":"SEO-optimised","prompt":"…"}]`;
}

/** Build the actual user prompt + system prompt pair for a description rewrite. */
export function buildDescriptionRewritePrompt(
  p: ProductContext,
  userPrompt: string,
  languageName: string
): { system: string; user: string } {
  const tagLine = p.tags.length > 0 ? `Existing tags: ${p.tags.slice(0, 15).join(', ')}` : '';
  // descriptionText is sliced to 2000 chars (~500 tokens). The
  // pricing.json `description.inputTokens` cap (1500) assumes this
  // truncation — without it merchants with long HTML descriptions
  // can push real input to 25K+ tokens, blowing through the kie cost
  // we quote and shrinking margin to ~1.5×. Keep this slice in sync
  // with the cap or update pricing.json in parallel.
  //
  // Length budget is enforced by the prompt (~180-220 words / ~1300
  // chars total) AND backed by pricing.json's description outputTokens
  // cap (600), which leaves a 1.5x safety margin so the model never
  // gets cut mid-sentence. Keep both in sync if you change one.
  return {
    system: `You are an expert e-commerce copywriter. Output ONLY the rewritten description, in clean HTML.

LENGTH IS A HARD CONSTRAINT. The description MUST be between 150 and 220 words total across the entire HTML output (count words, not characters). That's the SEO sweet spot for product pages. Every output must be a COMPLETE piece of copy — never cut mid-sentence, never leave a paragraph half-written. If you're approaching the budget, finish the current sentence cleanly and stop. If you have more to say, tighten earlier paragraphs to make room.

Structure (mandatory):
- 2-3 short <p> paragraphs (a wall-of-text is rejected).
- One <ul> with 3-5 <li> bullet points covering key benefits, materials or specs.
- Use <strong> on the 2-3 strongest value props. Use <em> sparingly.

Output must paste cleanly into Shopify / WooCommerce / Wix rich-text editors. No preamble, no commentary, no markdown fences, no trailing whitespace. Write the output in ${languageName}.`,
    user: `Rewrite the following product description per this instruction: "${userPrompt}"

Product context:
- Title: ${p.title}
- Vendor: ${p.vendor ?? '(none)'}
- Type: ${p.productType ?? '(none)'}
${tagLine}

Current description:
${p.descriptionText.slice(0, 2000) || '(empty)'}`
  };
}

/** Build prompt for tag suggestion: returns a JSON array of strings. */
export function buildTagSuggestionPrompt(
  p: ProductContext,
  userPrompt: string,
  languageName: string
): { system: string; user: string } {
  return {
    system: `You output strictly a JSON array of distinct tag strings (3-15 items). No preamble, no commentary, no markdown fences. Write the tags in ${languageName}.`,
    user: `Suggest tags for this product per this instruction: "${userPrompt}"

Product:
- Title: ${p.title}
- Type: ${p.productType ?? '(none)'}
- Description: ${p.descriptionText.slice(0, 400)}
${p.tags.length > 0 ? `\nExisting tags (suggest different ones): ${p.tags.slice(0, 15).join(', ')}` : ''}`
  };
}

// ============================================================================
// Alt text (vision)
// ============================================================================

/** Screen readers and search engines both stop reading past ~125 characters,
 *  and the store fields are short. Same ceiling as the editor's input
 *  (`ALT_MAX` in ui/image-editor/alt-text-field.tsx) and as the `alt`
 *  outputTokens cap in pricing.json. */
export const ALT_TEXT_MAX_CHARS = 125;

/**
 * The one prompt that sends an IMAGE. `user` is a content-block array — the
 * provider layer maps our `{type:'image'}` block to OpenAI's `image_url`
 * (chat-provider `toOpenAIContent`), so the same builder feeds OpenRouter and
 * the kie fallback.
 *
 * The model must describe what it SEES, not restate the catalog: an alt text
 * built from the title is exactly what the audit already penalises. The
 * product context is there to name the object correctly (a "grès" mug, a
 * brand), never to be repeated verbatim.
 */
export function buildAltTextPrompt(
  p: ProductContext,
  imageUrl: string,
  languageName: string
): { system: string; user: ChatContentBlock[] } {
  const tagLine = p.tags.length > 0 ? `Existing tags: ${p.tags.slice(0, 10).join(', ')}` : '';
  return {
    system: `You write alternative text (the HTML "alt" attribute) for e-commerce product photos. You are given the photo itself and some context about the product it belongs to.

Rules, all mandatory:
1. Describe what is ACTUALLY VISIBLE in the photo — the object, its material, colour, shape, and the setting it sits in. If the photo shows a detail, a packaging or a person using the product, say that.
2. HARD LIMIT: ${ALT_TEXT_MAX_CHARS} characters maximum, including spaces. Shorter is better. One plain sentence or noun phrase.
3. Never start with "photo of", "image of", "picture of", "a photo showing" or their equivalent in any language — a screen reader already announces that it is an image.
4. No keyword stuffing, no comma-separated keyword list, no brand slogan, no call to action, no price, no SEO padding.
5. Do not repeat the product title word for word. Do not invent anything the photo does not show.
6. Output the sentence ALONE: no quotes, no markdown, no bullet, no "Alt:" prefix, no trailing commentary, no closing period is required.
7. Write it in ${languageName}.`,
    user: [
      { type: 'image', source: { type: 'url', url: imageUrl } },
      {
        type: 'text',
        text: `Write the alternative text for the photo above.

Product context (for naming things correctly — do not copy it):
- Title: ${p.title}
- Type: ${p.productType ?? '(none)'}
- Vendor: ${p.vendor ?? '(none)'}
${tagLine}`
      }
    ]
  };
}

/**
 * Models add quotes, a "Alt:" label or a markdown wrapper despite rule 6 often
 * enough that trusting the raw string would put `"Mug en grès."` in the
 * merchant's store. Everything here is a shape fix, never a rewrite: what
 * survives is the model's own sentence, truncated on a word boundary.
 */
export function sanitizeAltText(raw: string): string {
  let text = raw.replace(/\r/g, '').trim();
  // Keep the first non-empty line: a chatty model puts its commentary after.
  text = (text.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
  text = text.replace(/^(?:alt(?:\s*text)?|texte\s*alternatif)\s*[:：-]\s*/i, '');
  text = text.replace(/^[*_`]+|[*_`]+$/g, '').trim();
  // Straight and typographic quotes, plus the French guillemets.
  text = text.replace(/^["'“”«»‘’]+|["'“”«»‘’]+$/g, '').trim();
  text = text.replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  if (text.length <= ALT_TEXT_MAX_CHARS) return text;
  const cut = text.slice(0, ALT_TEXT_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > ALT_TEXT_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Build prompt for title rewriting: returns plain text title (single line). */
export function buildTitleRewritePrompt(
  p: ProductContext,
  userPrompt: string,
  languageName: string
): { system: string; user: string } {
  // Length is enforced both in the prompt (so the model self-limits at
  // a clean word boundary) AND by pricing.json's title outputTokens
  // cap (100) which gives a ~25% safety margin for languages with
  // higher token density (FR/DE/PT). Keep both in sync.
  return {
    system: `You output strictly the rewritten product title — a single line, no quotes, no preamble, no commentary, no trailing punctuation, no period.

LENGTH IS A HARD CONSTRAINT. The title MUST be between 40 and 65 characters total (count spaces and accents). 6 to 10 words. If your draft is longer, REWRITE it shorter before outputting — never submit a long title hoping it gets accepted. A complete short title beats a clever long one every time.

Write the output in ${languageName}.`,
    user: `Rewrite this product title per this instruction: "${userPrompt}"

Current title: ${p.title}
Type: ${p.productType ?? '(none)'}
Vendor: ${p.vendor ?? '(none)'}`
  };
}
