import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '@/features/export-catalog/lib/csv';
import {
  exportHref,
  nextSortFor,
  parseColumns,
  parseExportQuery,
  MAX_PAGE
} from '@/features/export-catalog/lib/query';
import { COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS } from '@/features/export-catalog/model/columns';

describe('csvCell', () => {
  it('quotes only what needs quoting and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas in merchant-controlled text', () => {
    // A product title scraped from a store must never execute in Excel.
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"'
    );
    expect(csvCell('+1234')).toBe("'+1234");
    expect(csvCell('-50% sale')).toBe("'-50% sale");
    expect(csvCell('@user')).toBe("'@user");
  });
});

describe('toCsv', () => {
  it('writes a CRLF document with the header first', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', '2'],
          ['x,y', null]
        ]
      )
    ).toBe('a,b\r\n1,2\r\n"x,y",');
  });
});

describe('parseExportQuery', () => {
  it('falls back to safe defaults on junk', () => {
    const q = parseExportQuery({ page: 'abc', sort: 'DROP TABLE', dir: 'sideways' });
    expect(q).toMatchObject({ page: 1, sort: 'updatedAt', dir: 'desc', status: 'active' });
    expect(q.q).toBeNull();
    expect(q.columns).toEqual([...DEFAULT_COLUMN_KEYS]);
  });

  it('refuses to sort by a column that is not sortable', () => {
    // imageUrls is computed from JSON — sorting on it would mean a scan.
    expect(parseExportQuery({ sort: 'imageUrls' }).sort).toBe('updatedAt');
    expect(parseExportQuery({ sort: 'title' }).sort).toBe('title');
  });

  it('clamps the page and trims the search', () => {
    expect(parseExportQuery({ page: '-5' }).page).toBe(1);
    expect(parseExportQuery({ page: '99999' }).page).toBe(MAX_PAGE);
    expect(parseExportQuery({ q: '  robe  ' }).q).toBe('robe');
    expect(parseExportQuery({ q: 'x'.repeat(500) }).q?.length).toBe(120);
  });

  it('takes the first value when a param is repeated', () => {
    expect(parseExportQuery({ status: ['archived', 'all'] }).status).toBe('archived');
  });
});

describe('parseColumns', () => {
  it('keeps order, drops unknown keys and duplicates', () => {
    expect(parseColumns('sku,title,sku,nope')).toEqual(['sku', 'title']);
  });

  it('falls back to the defaults when nothing valid is left', () => {
    expect(parseColumns('nope,../../etc/passwd')).toEqual([...DEFAULT_COLUMN_KEYS]);
    expect(parseColumns('')).toEqual([...DEFAULT_COLUMN_KEYS]);
    expect(parseColumns(null)).toEqual([...DEFAULT_COLUMN_KEYS]);
  });

  it('only yields keys the catalogue knows', () => {
    for (const key of parseColumns('title,description,imageUrls')) {
      expect(COLUMN_BY_KEY.has(key)).toBe(true);
    }
  });
});

describe('exportHref', () => {
  it('omits defaults so a shared link stays short', () => {
    const q = parseExportQuery({});
    expect(exportHref('/x', q)).toBe('/x');
    expect(exportHref('/x', q, { page: 3 })).toBe('/x?page=3');
    expect(exportHref('/x', q, { q: 'robe', status: 'all' })).toBe('/x?q=robe&status=all');
  });
});

describe('nextSortFor', () => {
  it('flips the direction on the active column, starts desc on a new one', () => {
    const q = parseExportQuery({ sort: 'title', dir: 'desc' });
    expect(nextSortFor(q, 'title')).toMatchObject({ sort: 'title', dir: 'asc', page: 1 });
    expect(nextSortFor(q, 'sku')).toMatchObject({ sort: 'sku', dir: 'desc', page: 1 });
    expect(nextSortFor(q, 'imageUrls')).toEqual({});
  });
});
