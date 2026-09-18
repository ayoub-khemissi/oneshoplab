import { z } from 'zod';
import { IMPORT_LIMITS } from '../lib/parse-csv';
import { IMPORT_FIELDS } from './fields';

/**
 * What the browser sends for a preview and again for the commit: the raw
 * file text, the delimiter it settled on, and the mapping the merchant
 * confirmed. The server re-parses and re-validates everything — the client
 * preview is a courtesy, never an input the write path trusts.
 */
export const importRequestSchema = z.object({
  csv: z.string().min(1).max(IMPORT_LIMITS.maxBytes),
  delimiter: z.enum(['comma', 'semicolon', 'tab']).optional(),
  mapping: z.record(z.string().regex(/^\d{1,3}$/), z.enum(IMPORT_FIELDS).nullable())
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

/** JSON body ceiling: the file itself plus a little for the envelope. */
export const IMPORT_BODY_MAX_BYTES = IMPORT_LIMITS.maxBytes + 64 * 1024;
