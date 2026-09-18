/**
 * What a CSV column can be imported as, and how a header finds its field on
 * its own. The list mirrors what the export writes, so a file that came out
 * of OneShopLab maps itself; the aliases cover what merchants actually type
 * in French and English spreadsheets.
 */
export const IMPORT_FIELDS = [
  'title',
  'description',
  'tags',
  'vendor',
  'productType',
  'price',
  'priceMax',
  'currency',
  'sku',
  'handle',
  'imageUrls',
  'imageAlts'
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** CSV column index → field, or null to leave the column out. */
export type ColumnMapping = Record<number, ImportField | null>;

/** Lower-cased, accent-stripped header → field. */
const ALIASES: Record<ImportField, readonly string[]> = {
  title: ['title', 'titre', 'nom', 'name', 'product', 'produit', 'product_name', 'product name'],
  description: [
    'description',
    'description_html',
    'description html',
    'body',
    'body_html',
    'body (html)',
    'texte',
    'descriptif'
  ],
  tags: ['tags', 'tag', 'etiquettes', 'etiquette', 'mots-cles', 'mots cles', 'keywords', 'labels'],
  vendor: ['vendor', 'marque', 'brand', 'fournisseur', 'fabricant', 'manufacturer'],
  productType: [
    'product_type',
    'product type',
    'type',
    'categorie',
    'category',
    'collection',
    'famille'
  ],
  price: ['price', 'prix', 'price_min', 'prix min', 'tarif', 'amount', 'montant', 'variant price'],
  priceMax: ['price_max', 'prix max', 'prix maximum', 'max price'],
  currency: ['currency', 'devise', 'monnaie'],
  sku: ['sku', 'reference', 'ref', 'variant sku', 'variant_sku', 'code', 'ean', 'upc', 'gtin'],
  handle: ['handle', 'slug', 'identifiant', 'url key', 'url_key'],
  imageUrls: [
    'image_urls',
    'image urls',
    'images',
    'image',
    'image url',
    'image_url',
    'image src',
    'image_src',
    'photos',
    'photo',
    'liens des images',
    'lien image',
    'visuels'
  ],
  imageAlts: [
    'image_alts',
    'image alts',
    'alt',
    'alts',
    'image alt text',
    'textes alternatifs',
    'alt text'
  ]
};

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const LOOKUP = new Map<string, ImportField>();
for (const field of IMPORT_FIELDS) {
  for (const alias of ALIASES[field]) LOOKUP.set(normalizeHeader(alias), field);
}

/**
 * Guess a mapping from the headers. Each field is claimed at most once, by
 * the first header that matches it; a second `price` column is left unmapped
 * rather than silently overriding the first. The merchant can still change
 * every choice in the mapping step.
 */
export function autoMap(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<ImportField>();
  headers.forEach((h, i) => {
    const field = LOOKUP.get(normalizeHeader(h)) ?? null;
    if (field && !claimed.has(field)) {
      mapping[i] = field;
      claimed.add(field);
    } else {
      mapping[i] = null;
    }
  });
  return mapping;
}

/** Inverse view: field → column index, for the row normaliser. */
export function columnsByField(mapping: ColumnMapping): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field && out[field] === undefined) out[field] = Number(col);
  }
  return out;
}

/** True when the mapping can produce a product at all. */
export function mappingIsUsable(mapping: ColumnMapping): boolean {
  return Object.values(mapping).includes('title');
}
