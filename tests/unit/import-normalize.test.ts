import { describe, expect, it } from 'vitest';
import { indexExisting, matchExisting, planImport } from '@/features/import-catalog/lib/dedupe';
import {
  normalizeRow,
  parsePrice,
  sanitizeDescription,
  splitList,
  validateImageUrl
} from '@/features/import-catalog/lib/normalize';
import { autoMap, columnsByField, mappingIsUsable } from '@/features/import-catalog/model/fields';

describe('autoMap', () => {
  it('maps our own export headers back onto every field', () => {
    const headers = [
      'title',
      'sku',
      'vendor',
      'product_type',
      'price',
      'currency',
      'tags',
      'description_html',
      'image_urls',
      'image_alts',
      'handle'
    ];
    const m = columnsByField(autoMap(headers));
    expect(m.title).toBe(0);
    expect(m.sku).toBe(1);
    expect(m.vendor).toBe(2);
    expect(m.productType).toBe(3);
    expect(m.price).toBe(4);
    expect(m.currency).toBe(5);
    expect(m.tags).toBe(6);
    expect(m.description).toBe(7);
    expect(m.imageUrls).toBe(8);
    expect(m.imageAlts).toBe(9);
    expect(m.handle).toBe(10);
  });

  it('understands French spreadsheets, accents included', () => {
    const m = columnsByField(
      autoMap(['Nom', 'Référence', 'Prix', 'Étiquettes', 'Marque', 'Photos'])
    );
    expect(m.title).toBe(0);
    expect(m.sku).toBe(1);
    expect(m.price).toBe(2);
    expect(m.tags).toBe(3);
    expect(m.vendor).toBe(4);
    expect(m.imageUrls).toBe(5);
  });

  it('claims each field once and leaves the unknown unmapped', () => {
    const mapping = autoMap(['price', 'Prix', 'mystery']);
    expect(mapping[0]).toBe('price');
    expect(mapping[1]).toBeNull();
    expect(mapping[2]).toBeNull();
    expect(mappingIsUsable(mapping)).toBe(false);
    expect(mappingIsUsable(autoMap(['title']))).toBe(true);
  });
});

describe('parsePrice', () => {
  it('reads every way a merchant writes a price', () => {
    expect(parsePrice('24.00')).toBe(24);
    expect(parsePrice('24,00')).toBe(24);
    expect(parsePrice('€24')).toBe(24);
    expect(parsePrice('24 €')).toBe(24);
    expect(parsePrice('1 299,90')).toBe(1299.9);
    expect(parsePrice('1,299.90')).toBe(1299.9);
    expect(parsePrice('1.299,90')).toBe(1299.9);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('-5')).toBe('invalid');
  });
});

describe('splitList', () => {
  it('splits on the pipe our export uses, else on commas', () => {
    expect(splitList('a | b | c')).toEqual(['a', 'b', 'c']);
    expect(splitList('a, b,c')).toEqual(['a', 'b', 'c']);
    expect(splitList('')).toEqual([]);
  });
});

describe('sanitizeDescription', () => {
  it('keeps structure and strips anything that could run', () => {
    const dirty =
      '<p onclick="steal()">Hello <script>alert(1)</script><a href="javascript:evil()">x</a> ' +
      '<a href="https://ok.example/p">ok</a></p><img src=x onerror=alert(1)>';
    const clean = sanitizeDescription(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<img');
    expect(clean).toContain('<a href="https://ok.example/p" rel="nofollow noopener">ok</a>');
  });

  it('turns plain text into paragraphs, escaping what looks like markup', () => {
    expect(sanitizeDescription('Line one\n\nLine two & more')).toBe(
      '<p>Line one</p>\n<p>Line two &amp; more</p>'
    );
    expect(sanitizeDescription('   ')).toBe('');
  });
});

describe('validateImageUrl', () => {
  it('accepts https only, without credentials', () => {
    expect(validateImageUrl('https://cdn.example.com/a.jpg')).toMatchObject({ ok: true });
    expect(validateImageUrl('http://cdn.example.com/a.jpg')).toMatchObject({
      code: 'image_url_insecure'
    });
    expect(validateImageUrl('https://user:pw@cdn.example.com/a.jpg')).toMatchObject({
      code: 'image_url_invalid'
    });
    expect(validateImageUrl('ftp://x/a.jpg')).toMatchObject({ code: 'image_url_invalid' });
    expect(validateImageUrl('not a url')).toMatchObject({ code: 'image_url_invalid' });
  });
});

describe('normalizeRow', () => {
  const mapping = autoMap([
    'title',
    'description',
    'price',
    'price_max',
    'currency',
    'tags',
    'sku',
    'image_urls',
    'image_alts'
  ]);

  it('produces a complete product input', () => {
    const v = normalizeRow(
      [
        'Robe longue',
        '<p>Coton</p>',
        '24,90',
        '',
        'eur',
        'été | coton',
        'RB-1',
        'https://c.example/a.jpg | https://c.example/b.jpg',
        'devant | dos'
      ],
      mapping,
      1
    );
    expect(v.errors).toEqual([]);
    expect(v.input).toMatchObject({
      title: 'Robe longue',
      descriptionHtml: '<p>Coton</p>',
      priceMin: 24.9,
      priceMax: 24.9,
      currency: 'EUR',
      tags: ['été', 'coton'],
      sku: 'RB-1',
      handle: 'robe-longue'
    });
    expect(v.input?.images).toEqual([
      { src: 'https://c.example/a.jpg', alt: 'devant' },
      { src: 'https://c.example/b.jpg', alt: 'dos' }
    ]);
  });

  it('rejects what cannot become a product, and says why', () => {
    const noTitle = normalizeRow(
      ['', '', '10', '', '', '', '', 'https://c.example/a.jpg', ''],
      mapping,
      2
    );
    expect(noTitle.input).toBeNull();
    expect(noTitle.errors.map((e) => e.code)).toContain('title_missing');

    const badPrice = normalizeRow(
      ['A', '', '-3', '', '', '', '', 'https://c.example/a.jpg', ''],
      mapping,
      3
    );
    expect(badPrice.errors.map((e) => e.code)).toContain('price_invalid');

    const inverted = normalizeRow(
      ['A', '', '20', '10', '', '', '', 'https://c.example/a.jpg', ''],
      mapping,
      4
    );
    expect(inverted.errors.map((e) => e.code)).toContain('price_max_below_min');

    const noImage = normalizeRow(['A', '', '', '', '', '', '', '', ''], mapping, 5);
    expect(noImage.errors.map((e) => e.code)).toEqual(['no_image']);
    expect(
      normalizeRow(['A', '', '', '', '', '', '', '', ''], mapping, 5, { requireImage: false }).input
    ).not.toBeNull();

    const badCurrency = normalizeRow(
      ['A', '', '', '', 'euros', '', '', 'https://c.example/a.jpg', ''],
      mapping,
      6
    );
    expect(badCurrency.errors.map((e) => e.code)).toContain('currency_invalid');
  });

  it('truncates rather than rejects what is merely too long', () => {
    const v = normalizeRow(
      [
        'x'.repeat(600),
        '',
        '',
        '',
        '',
        Array.from({ length: 60 }, (_, i) => `t${i}`).join(','),
        '',
        'https://c.example/a.jpg',
        ''
      ],
      mapping,
      7
    );
    expect(v.input?.title).toHaveLength(512);
    expect(v.input?.tags).toHaveLength(50);
    expect(v.warnings.map((w) => w.code).sort()).toEqual(['title_too_long', 'too_many_tags']);
  });
});

describe('planImport', () => {
  const mapping = autoMap(['title', 'sku', 'image_urls']);
  const row = (n: number, title: string, sku = '') =>
    normalizeRow([title, sku, 'https://c.example/a.jpg'], mapping, n);
  const existing = indexExisting([
    { id: 'p-1', sku: 'RB-1', handle: 'robe-longue', title: 'Robe longue' },
    { id: 'p-2', sku: null, handle: 'chemise', title: 'Chemise' }
  ]);

  it('matches by sku, then handle, then title', () => {
    expect(matchExisting(row(1, 'Whatever', 'rb-1').input!, existing)).toBe('p-1');
    expect(matchExisting(row(1, 'Chemise').input!, existing)).toBe('p-2');
    expect(matchExisting(row(1, 'CHEMISE  ').input!, existing)).toBe('p-2');
    expect(matchExisting(row(1, 'Nouveau').input!, existing)).toBeNull();
  });

  it('updates matches, creates the rest, skips in-file duplicates and the excess over the plan', () => {
    const plan = planImport(
      [
        row(1, 'Chemise'),
        row(2, 'Nouveau A'),
        row(3, 'Nouveau A'),
        row(4, 'Nouveau B'),
        row(5, ''),
        row(6, 'Nouveau C')
      ],
      existing,
      2
    );
    expect(plan.rows.map((r) => r.action)).toEqual([
      'update',
      'create',
      'skip',
      'create',
      'reject',
      'skip'
    ]);
    expect(plan.rows[2].reason).toBe('duplicate_in_file');
    expect(plan.rows[5].reason).toBe('plan_limit');
    expect(plan.counts).toEqual({ create: 2, update: 1, skip: 2, reject: 1 });
    expect(plan.overLimit).toBe(1);
  });
});
