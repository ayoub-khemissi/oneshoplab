import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/import/template/route';
import { NextRequest } from 'next/server';
import {
  autoMap,
  buildTemplateCsv,
  columnsByField,
  normalizeRow,
  parseCsv,
  TEMPLATE_ROWS
} from '@/features/import-catalog/client';

describe('import template', () => {
  it('round-trips through the parser and maps every column by itself', () => {
    for (const sep of ['semicolon', 'comma', 'tab'] as const) {
      const parsed = parseCsv(buildTemplateCsv(sep));
      expect(parsed.delimiter).toBe(sep);
      expect(parsed.issues).toEqual([]);
      expect(parsed.rows).toHaveLength(TEMPLATE_ROWS.length);
      const mapped = columnsByField(autoMap(parsed.headers));
      expect(Object.keys(mapped).sort()).toEqual([
        'currency',
        'description',
        'imageAlts',
        'imageUrls',
        'price',
        'productType',
        'sku',
        'tags',
        'title',
        'vendor'
      ]);
      // Every sample row is a valid product: the template must never teach a mistake.
      const mapping = autoMap(parsed.headers);
      parsed.rows.forEach((cells, i) => {
        const v = normalizeRow(cells, mapping, i + 1);
        expect(v.errors).toEqual([]);
        expect(v.input?.images.length).toBeGreaterThan(0);
      });
    }
  });

  it('is served as an attachment, tab as .tsv, junk separator falls back', async () => {
    const csv = GET(new NextRequest('http://localhost/api/import/template?sep=semicolon'));
    expect(csv.headers.get('Content-Disposition')).toContain('.csv');
    // text() strips the BOM per the Fetch spec; the bytes are what Excel reads.
    const bytes = Buffer.from(await csv.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3, 12).toString('utf8')).toBe('title;sku');
    const tsv = GET(new NextRequest('http://localhost/api/import/template?sep=tab'));
    expect(tsv.headers.get('Content-Disposition')).toContain('.tsv');
    const junk = GET(new NextRequest('http://localhost/api/import/template?sep=pipe'));
    expect((await junk.text()).includes('title;sku')).toBe(true);
  });
});
