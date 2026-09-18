/**
 * Client-safe entry: the pure half of the import, which the browser runs to
 * show headers, mapping and a first preview before anything is sent. The
 * data layer lives behind index.ts and must never reach a client bundle.
 */
export {
  CSV_DELIMITERS,
  IMPORT_LIMITS,
  detectDelimiter,
  parseCsv,
  stripBom,
  type CsvDelimiterId,
  type CsvIssue,
  type CsvIssueCode,
  type ImportLimits,
  type ParsedCsv
} from './lib/parse-csv';
export {
  IMPORT_FIELDS,
  autoMap,
  columnsByField,
  mappingIsUsable,
  normalizeHeader,
  type ColumnMapping,
  type ImportField
} from './model/fields';
export {
  ROW_LIMITS,
  normalizeRow,
  parsePrice,
  sanitizeDescription,
  splitList,
  validateImageUrl,
  type ImportImage,
  type ImportRowInput,
  type RowIssue,
  type RowIssueCode,
  type RowValidation
} from './lib/normalize';
export {
  indexExisting,
  matchExisting,
  planImport,
  type ExistingProduct,
  type ImportPlan,
  type PlannedRow,
  type RowAction,
  type SkipReason
} from './lib/dedupe';
export { buildTemplateCsv, TEMPLATE_HEADERS, TEMPLATE_ROWS } from './lib/template';
