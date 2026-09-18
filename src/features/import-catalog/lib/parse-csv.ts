/**
 * CSV reading for the catalogue import. Pure: no I/O, runs in the browser for
 * the mapping preview and again on the server, which never trusts the
 * client's parse.
 *
 * RFC 4180 with the things real files do: a UTF-8 BOM, CRLF or LF, a
 * delimiter that is not always a comma, quoted cells holding the delimiter,
 * a line break or a doubled quote, and rows that are shorter or longer than
 * the header. Everything is bounded — bytes, rows, columns, cell length — so
 * a hostile or merely huge file costs a predictable amount of memory.
 */

export type CsvDelimiterId = 'comma' | 'semicolon' | 'tab';

export const CSV_DELIMITERS: Record<CsvDelimiterId, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t'
};

export interface ImportLimits {
  /** Raw text, after decoding. 5 MB of CSV is roughly 20 000 product rows. */
  maxBytes: number;
  /** Data rows, header excluded. Above this the merchant splits the file. */
  maxRows: number;
  maxColumns: number;
  /** One cell — a description is well under this; a runaway quote is not. */
  maxCellChars: number;
}

export const IMPORT_LIMITS: ImportLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 60,
  maxCellChars: 50_000
};

export type CsvIssueCode =
  | 'empty_file'
  | 'header_only'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'cell_too_long'
  | 'unterminated_quote'
  | 'ragged_row'
  | 'duplicate_header'
  | 'empty_header';

export interface CsvIssue {
  code: CsvIssueCode;
  /** 1-based data row (header is row 0); absent for file-level issues. */
  row?: number;
  column?: number;
  detail?: string;
}

export interface ParsedCsv {
  delimiter: CsvDelimiterId;
  headers: string[];
  /** Every row padded or trimmed to the header width. */
  rows: string[][];
  issues: CsvIssue[];
  /** True when rows had to be dropped to honour maxRows. */
  truncated: boolean;
}

/** Strip a UTF-8 byte order mark; Excel writes one, most parsers choke on it. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the delimiter from the first lines: the candidate that splits them
 * into the most columns, consistently. Quoted regions are respected, which
 * is what separates this from a naive count — a comma inside a quoted
 * description must not vote.
 */
export function detectDelimiter(text: string): CsvDelimiterId {
  const sample = stripBom(text).split(/\r?\n/).slice(0, 10).join('\n');
  let best: CsvDelimiterId = 'comma';
  let bestScore = -1;
  for (const id of Object.keys(CSV_DELIMITERS) as CsvDelimiterId[]) {
    const counts = countPerLine(sample, CSV_DELIMITERS[id]);
    if (counts.length === 0) continue;
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((c) => c === first);
    // A consistent width across lines is worth more than a single wide line.
    const score = first * (consistent ? 10 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function countPerLine(sample: string, delimiter: string): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let count = 0;
  let sawAny = false;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === delimiter) {
      count++;
      sawAny = true;
    } else if (!inQuotes && ch === '\n') {
      if (sawAny || count > 0) counts.push(count);
      count = 0;
      sawAny = false;
    }
  }
  if (sawAny || count > 0) counts.push(count);
  return counts;
}

/**
 * Parse the whole text. The header is the first row; a header cell is
 * trimmed and, when empty or duplicated, reported — the mapping step needs
 * unambiguous names.
 */
export function parseCsv(
  input: string,
  opts: { delimiter?: CsvDelimiterId; limits?: Partial<ImportLimits> } = {}
): ParsedCsv {
  const limits = { ...IMPORT_LIMITS, ...opts.limits };
  const text = stripBom(input).slice(0, limits.maxBytes);
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const sep = CSV_DELIMITERS[delimiter];
  const issues: CsvIssue[] = [];

  const records = tokenize(text, sep, limits, issues);
  if (records.length === 0 || (records.length === 1 && records[0].every((c) => c === ''))) {
    return { delimiter, headers: [], rows: [], issues: [{ code: 'empty_file' }], truncated: false };
  }

  const headers = records[0].map((h) => h.trim());
  if (headers.length > limits.maxColumns) {
    issues.push({ code: 'too_many_columns', detail: String(headers.length) });
  }
  const seen = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h === '') issues.push({ code: 'empty_header', column: i + 1 });
    const key = h.toLowerCase();
    if (seen.has(key)) issues.push({ code: 'duplicate_header', column: i + 1, detail: h });
    seen.set(key, i);
  });

  const body = records.slice(1).filter((r) => !(r.length === 1 && r[0] === ''));
  if (body.length === 0) {
    return {
      delimiter,
      headers,
      rows: [],
      issues: [...issues, { code: 'header_only' }],
      truncated: false
    };
  }

  const truncated = body.length > limits.maxRows;
  if (truncated) issues.push({ code: 'too_many_rows', detail: String(body.length) });
  const kept = body.slice(0, limits.maxRows);

  const width = headers.length;
  const rows = kept.map((r, idx) => {
    if (r.length !== width)
      issues.push({ code: 'ragged_row', row: idx + 1, detail: String(r.length) });
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });

  return { delimiter, headers, rows, issues, truncated };
}

/** Character-level RFC 4180 tokenizer. */
function tokenize(text: string, sep: string, limits: ImportLimits, issues: CsvIssue[]): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushCell = () => {
    if (cell.length > limits.maxCellChars) {
      issues.push({ code: 'cell_too_long', row: records.length, column: row.length + 1 });
      cell = cell.slice(0, limits.maxCellChars);
    }
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    records.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      pushCell();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQuotes) issues.push({ code: 'unterminated_quote', row: records.length });
  if (cell !== '' || row.length > 0) pushRow();
  return records;
}
