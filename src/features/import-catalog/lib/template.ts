import { CSV_DELIMITERS, type CsvDelimiterId } from './parse-csv';

/**
 * The sample file a merchant downloads before their first import. A store
 * with no products cannot export one to copy, so the template has to exist
 * on its own: our export headers (they auto-map back), three rows that show
 * every convention — pipe-separated lists, HTML or plain text, decimal
 * comma, several images, an optional field left empty.
 */
export const TEMPLATE_HEADERS = [
  'title',
  'sku',
  'price',
  'currency',
  'vendor',
  'product_type',
  'tags',
  'description',
  'image_urls',
  'image_alts'
] as const;

const IMG1 = 'https://oneshoplab.com/tour/demo-tshirt-1.webp';
const IMG2 = 'https://oneshoplab.com/tour/demo-tshirt-2.webp';

export const TEMPLATE_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    'T-shirt col rond en coton, unisexe',
    'TS-001',
    '24,90',
    'EUR',
    'Atelier Nord',
    'T-shirts',
    't-shirt | coton | unisexe',
    '<p>Coupe classique, coton peigné 180 g, coutures renforcées. Lavable à 30°.</p>',
    `${IMG1} | ${IMG2}`,
    'vue de face | plié'
  ],
  [
    'Bougie en cire de soja, vanille',
    'BG-014',
    '18,00',
    'EUR',
    'Atelier Nord',
    'Maison',
    'bougie | maison',
    'Coulée à la main, mèche en coton, environ 40 heures de combustion.',
    IMG2,
    'bougie allumée'
  ],
  [
    'Tote bag en toile épaisse',
    'TB-002',
    '12,50',
    'EUR',
    '',
    'Accessoires',
    'sac | toile',
    'Anses longues, fond plat, 38 x 42 cm.',
    IMG1,
    ''
  ]
];

function cell(value: string, sep: string): string {
  const mustQuote = value.includes(sep) || value.includes('"') || /[\n\r]/.test(value);
  return mustQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 BOM first: Excel on Windows reads the accents only with it. */
export function buildTemplateCsv(delimiter: CsvDelimiterId = 'semicolon'): string {
  const sep = CSV_DELIMITERS[delimiter];
  const lines = [TEMPLATE_HEADERS.map((h) => cell(h, sep)).join(sep)];
  for (const row of TEMPLATE_ROWS) lines.push(row.map((v) => cell(v, sep)).join(sep));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
