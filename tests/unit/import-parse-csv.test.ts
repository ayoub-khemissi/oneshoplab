import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, stripBom } from '@/features/import-catalog/lib/parse-csv';

describe('detectDelimiter', () => {
  it('picks the separator that splits the lines consistently', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe('comma');
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe('semicolon');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('tab');
  });

  it('does not let a comma inside quotes vote', () => {
    // Semicolon file whose description holds commas.
    expect(detectDelimiter('title;description\n"Robe, longue, noire";"Coton, lin"\n')).toBe(
      'semicolon'
    );
  });
});

describe('parseCsv', () => {
  it('reads header and rows, honouring quotes, doubled quotes and line breaks', () => {
    const text =
      'title,description,price\r\n' +
      '"Robe, longue","Say ""hi""\nline 2",24.00\r\n' +
      'Chemise,,12\r\n';
    const out = parseCsv(text);
    expect(out.delimiter).toBe('comma');
    expect(out.headers).toEqual(['title', 'description', 'price']);
    expect(out.rows).toEqual([
      ['Robe, longue', 'Say "hi"\nline 2', '24.00'],
      ['Chemise', '', '12']
    ]);
    expect(out.issues).toEqual([]);
  });

  it('strips the BOM Excel writes', () => {
    expect(stripBom('﻿title')).toBe('title');
    expect(parseCsv('﻿title,sku\nA,1\n').headers).toEqual(['title', 'sku']);
  });

  it('pads short rows, trims long ones, and says so', () => {
    const out = parseCsv('a,b,c\n1,2\n1,2,3,4\n');
    expect(out.rows).toEqual([
      ['1', '2', ''],
      ['1', '2', '3']
    ]);
    expect(out.issues.map((i) => i.code)).toEqual(['ragged_row', 'ragged_row']);
  });

  it('reports an empty file, a header-only file, and bad headers', () => {
    expect(parseCsv('').issues.map((i) => i.code)).toEqual(['empty_file']);
    expect(parseCsv('title,sku\n').issues.map((i) => i.code)).toEqual(['header_only']);
    const bad = parseCsv('title,,Title\nA,B,C\n');
    expect(bad.issues.map((i) => i.code).sort()).toEqual(['duplicate_header', 'empty_header']);
  });

  it('caps rows and flags the truncation instead of eating memory', () => {
    const lines = ['title'];
    for (let i = 0; i < 20; i++) lines.push(`P${i}`);
    const out = parseCsv(lines.join('\n'), { limits: { maxRows: 5 } });
    expect(out.rows).toHaveLength(5);
    expect(out.truncated).toBe(true);
    expect(out.issues.some((i) => i.code === 'too_many_rows')).toBe(true);
  });

  it('bounds a runaway quote and a giant cell', () => {
    const open = parseCsv('title\n"never closed\nmore');
    expect(open.issues.some((i) => i.code === 'unterminated_quote')).toBe(true);
    const long = parseCsv(`title\n${'x'.repeat(200)}\n`, { limits: { maxCellChars: 50 } });
    expect(long.rows[0][0]).toHaveLength(50);
    expect(long.issues.some((i) => i.code === 'cell_too_long')).toBe(true);
  });

  it('tells a Latin-1 file apart from a UTF-8 one', () => {
    // What the browser produces when it decodes "Crème" saved as Latin-1.
    const out = parseCsv('title\nCr\uFFFDme solaire\n');
    expect(out.issues.map((i) => i.code)).toContain('bad_encoding');
    expect(parseCsv('title\nCrème solaire\n').issues).toEqual([]);
  });

  it('accepts a forced delimiter over the guess', () => {
    const out = parseCsv('a;b\n1;2\n', { delimiter: 'comma' });
    expect(out.headers).toEqual(['a;b']);
  });
});
