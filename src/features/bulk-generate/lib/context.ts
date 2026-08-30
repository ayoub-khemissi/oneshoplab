import type { ProductContext } from '@/entities/generation-job';

interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface SummaryProduct {
  sourceId: string | null;
  handle: string | null;
  title: string;
  descriptionHtml: string;
  images: ProductImage[];
  signals: {
    tags?: string[];
    vendor?: string | null;
    productType?: string | null;
    priceMin?: number | null;
    priceMax?: number | null;
  };
}

export interface SummaryShape {
  worstProducts?: SummaryProduct[];
  latestProducts?: SummaryProduct[];
  bestProducts?: SummaryProduct[];
  allProducts?: SummaryProduct[];
}

const FIELD_DEFAULT_PROMPT = {
  title:
    'Rewrite this title to be SEO-optimised, keyword-front-loaded and more compelling. Stay factually consistent with the product.',
  description:
    'Rewrite this description as benefit-led, scannable HTML (use <p>, <ul>, <li>, <strong>). 180-350 words. Stay factually consistent with the product.',
  tags: 'Suggest 5-10 customer-facing discovery tags for this product.'
} as const;

export function effectiveChatPrompt(
  field: 'title' | 'description' | 'tags',
  custom: string
): string {
  const trimmed = custom.trim();
  return trimmed
    ? `${FIELD_DEFAULT_PROMPT[field]}\n\nAdditional instructions from the merchant:\n${trimmed}`
    : FIELD_DEFAULT_PROMPT[field];
}

export function combineInstructions(
  projectInstructions: string | null,
  productInstructions: string
): string {
  const parts: string[] = [];
  if (projectInstructions && projectInstructions.trim()) {
    parts.push(`Site-wide brand guidance:\n${projectInstructions.trim()}`);
  }
  if (productInstructions && productInstructions.trim()) {
    parts.push(`Product-specific guidance:\n${productInstructions.trim()}`);
  }
  return parts.join('\n\n');
}

export function toProductContext(p: SummaryProduct): ProductContext {
  const text = p.descriptionHtml
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: p.title,
    descriptionText: text,
    vendor: p.signals.vendor ?? null,
    productType: p.signals.productType ?? null,
    tags: p.signals.tags ?? [],
    imageCount: p.images.length,
    priceMin: p.signals.priceMin ?? null,
    priceMax: p.signals.priceMax ?? null,
    currency: null
  };
}
