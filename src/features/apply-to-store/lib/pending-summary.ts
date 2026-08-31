/**
 * Pure shaping of the "changes waiting for your store" recap: excerpts, image
 * op wording, per-status counts and grouping. No React, no db — the modal and
 * the queries share these so the banner count and the modal list can never
 * disagree.
 */
import { isImageOpsPayload, type ImageOp } from '@/entities/product-change/client';
import type { ProductChangeField } from '@/shared/db/schema';
import { describeOp, type OpDescription, type RefNamer } from './image-editor';
import type {
  PendingChangeDetail,
  PendingChangeItem,
  PendingChangeStatus,
  PendingCounts
} from '../model/types';

/** Long enough to recognise the sentence, short enough to scan a list. */
export const EXCERPT_MAX = 160;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'"
};

/**
 * A field value as one line of plain text. Descriptions arrive as HTML and
 * tags as an array, so both are flattened here rather than in every caller.
 */
export function toExcerpt(value: unknown, max: number = EXCERPT_MAX): string | null {
  const raw = Array.isArray(value)
    ? value.filter((v) => typeof v === 'string').join(', ')
    : typeof value === 'string'
      ? value
      : null;
  if (raw === null) return null;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

interface PriorImageShape {
  src?: unknown;
  sourceImageId?: unknown;
}

/** Prior gallery in the shape the ops address it (`entities/product-change`). */
export function priorImageRefs(priorValue: unknown): Array<{ ref: string; src: string }> {
  if (!Array.isArray(priorValue)) return [];
  return priorValue.map((img, i) => {
    const entry = (img ?? {}) as PriorImageShape;
    return {
      ref: typeof entry.sourceImageId === 'string' ? entry.sourceImageId : `pos:${i}`,
      src: typeof entry.src === 'string' ? entry.src : ''
    };
  });
}

/** What the modal renders under one change. */
export function buildPendingDetail(
  field: ProductChangeField,
  value: unknown,
  priorValue: unknown
): PendingChangeDetail {
  if (field !== 'images') {
    return { kind: 'text', before: toExcerpt(priorValue), after: toExcerpt(value) };
  }
  const prior = priorImageRefs(priorValue);
  if (isImageOpsPayload(value)) {
    return { kind: 'imageOps', ops: value.ops, prior };
  }
  // The historical "replace the whole gallery" payload (IMAGE-OPS.md §5).
  return {
    kind: 'imageReplaceAll',
    before: prior.length,
    after: Array.isArray(value) ? value.length : 0
  };
}

export interface PhotoLabels {
  /** "Photo 3" — 1-based, as the image editor names them. */
  photo: (n: number) => string;
  /** A photo the change itself introduces, absent from the prior gallery. */
  added: string;
}

/** Names a ref/src the way the product page's image editor does. */
export function photoNamer(
  prior: ReadonlyArray<{ ref: string; src: string }>,
  labels: PhotoLabels
): RefNamer {
  const byRef = new Map(prior.map((p, i) => [p.ref, i]));
  const bySrc = new Map(prior.map((p, i) => [p.src, i]));
  const name = (index: number | undefined) =>
    index === undefined ? labels.added : labels.photo(index + 1);
  return {
    byRef: (ref) => name(byRef.get(ref)),
    bySrc: (src) => name(bySrc.get(src))
  };
}

/** The queued ops in plain words — same vocabulary as the image editor. */
export function imageOpDescriptions(
  ops: readonly ImageOp[],
  prior: ReadonlyArray<{ ref: string; src: string }>,
  labels: PhotoLabels
): OpDescription[] {
  const namer = photoNamer(prior, labels);
  return ops.map((op) => describeOp(op, namer));
}

/**
 * A conflict or a failure that has been sent again since is history — the row
 * is terminal and would otherwise sit in the list forever, next to the fresh
 * pending one that replaced it. Only the newest change per product+field still
 * asks something of the merchant. Rows must arrive newest first.
 */
export function dropSuperseded<
  T extends { productId: string; field: string; status: PendingChangeStatus }
>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = `${row.productId}:${row.field}`;
    if (row.status !== 'pending' && seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function countPending(items: ReadonlyArray<{ status: PendingChangeStatus }>): PendingCounts {
  const counts: PendingCounts = { total: 0, pending: 0, conflict: 0, failed: 0 };
  for (const item of items) {
    counts.total += 1;
    counts[item.status] += 1;
  }
  return counts;
}

export function addCounts(a: PendingCounts, b: PendingCounts): PendingCounts {
  return {
    total: a.total + b.total,
    pending: a.pending + b.pending,
    conflict: a.conflict + b.conflict,
    failed: a.failed + b.failed
  };
}

export interface PendingProductGroup {
  productId: string;
  productTitle: string;
  items: PendingChangeItem[];
}

/** Groups the modal's rows by product, keeping the incoming (newest-first) order. */
export function groupByProduct(items: readonly PendingChangeItem[]): PendingProductGroup[] {
  const groups: PendingProductGroup[] = [];
  const byId = new Map<string, PendingProductGroup>();
  for (const item of items) {
    let group = byId.get(item.productId);
    if (!group) {
      group = { productId: item.productId, productTitle: item.productTitle, items: [] };
      byId.set(item.productId, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export interface ResultLabels {
  queued: (n: number) => string;
  conflict: (n: number) => string;
  failed: (n: number) => string;
}

/**
 * "2 sent, 1 in conflict" — only the non-zero parts, so a clean run reads as
 * one short sentence instead of a table of zeros.
 */
export function resultParts(
  counts: { queued: number; conflict: number; failed: number },
  labels: ResultLabels
): string[] {
  const parts: string[] = [];
  if (counts.queued > 0) parts.push(labels.queued(counts.queued));
  if (counts.conflict > 0) parts.push(labels.conflict(counts.conflict));
  if (counts.failed > 0) parts.push(labels.failed(counts.failed));
  return parts;
}
