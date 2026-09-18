import type { PlannedRow, RowAction, SkipReason } from '../lib/dedupe';
import type { RowIssue } from '../lib/normalize';
import type { CsvIssue, CsvDelimiterId } from '../lib/parse-csv';
import type { ImportRequest } from '../model/request';
import { blockingIssues, resolvePlan } from './plan';

/** One row's verdict, without the row itself — the browser already has it. */
export interface PreviewRow {
  row: number;
  action: RowAction;
  reason?: SkipReason;
  productId?: string;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface ImportPreview {
  delimiter: CsvDelimiterId;
  headers: string[];
  issues: CsvIssue[];
  truncated: boolean;
  blocked: boolean;
  counts: { create: number; update: number; skip: number; reject: number };
  overLimit: number;
  room: number;
  rows: PreviewRow[];
}

function toPreviewRow(r: PlannedRow): PreviewRow {
  return {
    row: r.row,
    action: r.action,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.productId ? { productId: r.productId } : {}),
    errors: r.errors,
    warnings: r.warnings
  };
}

/** Dry run: everything the commit would do, nothing written. */
export async function previewImport(projectId: string, req: ImportRequest): Promise<ImportPreview> {
  const { parsed, plan, room } = await resolvePlan(projectId, req);
  return {
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    issues: parsed.issues,
    truncated: parsed.truncated,
    blocked: blockingIssues(parsed).length > 0,
    counts: plan.counts,
    overLimit: plan.overLimit,
    room,
    rows: plan.rows.map(toPreviewRow)
  };
}
