import { Accordion, Card } from '@heroui/react';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { HistoryImage } from '@/features/generate-product-images';
import { ImageExpiry } from '@/features/generate-product-images';
import { ServerPagination } from '@/shared/ui';
import type { OptimHistoryItem } from '@/entities/generation-job';
import { ApplyToStoreButton, type ChangeSummary } from '@/features/apply-to-store';
import { formatDate } from '@/shared/lib';

const PAST_GEN_DETAIL_LIMIT = 600;

export function PastGenerationsSection({
  title,
  emptyText,
  items,
  retentionDays,
  page,
  totalPages,
  siteId,
  archived,
  canApplyToStore,
  changeByJobId,
  replaceAllImages,
  currentImageCount
}: {
  title: string;
  emptyText: string;
  items: OptimHistoryItem[];
  /** Plan-specific retention; surfaces on the per-image expiry caption
   *  so the past-generations panel matches the live grid. */
  retentionDays: number;
  page: number;
  totalPages: number;
  siteId: string;
  archived: boolean;
  /** A usable site key exists — otherwise the row shows a link to set one up. */
  canApplyToStore: boolean;
  changeByJobId: Record<string, ChangeSummary>;
  /** The store cannot be addressed image by image → applying replaces the
   *  whole gallery, which the merchant must confirm (IMAGE-OPS.md §5). */
  replaceAllImages: boolean;
  /** Photos currently on the product — the "n" of the confirmation sentence. */
  currentImageCount: number;
}) {
  const tDash = useTranslations('Dashboard');
  if (items.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)] italic">{emptyText}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Card variant="secondary" className="p-0">
        <Accordion>
          {items.map((h) => (
            <Accordion.Item
              key={h.jobId}
              id={h.jobId}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              <Accordion.Heading>
                <Accordion.Trigger className="w-full px-4 py-3 flex items-center gap-3 text-sm text-left hover:bg-[var(--default)]/40 transition-colors">
                  <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium shrink-0 min-w-[7rem]">
                    {tDash(pastGenLabelKey(h.field))}
                  </span>
                  <span className="flex-1 truncate text-[var(--muted)]">
                    {pastGenInlinePreview(h.output)}
                  </span>
                  {h.field === 'images' ? (
                    <ImageExpiry
                      createdAt={h.createdAt}
                      retentionDays={retentionDays}
                      expiredAt={h.expiredAt}
                      className="shrink-0"
                    />
                  ) : null}
                  {h.creditsCost > 0 ? (
                    <span className="text-xs text-[var(--muted)] font-mono tabular-nums shrink-0 inline-flex items-center gap-1">
                      <Coins className="size-3" aria-hidden />
                      {h.creditsCost}
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--muted)] font-mono tabular-nums shrink-0">
                    {formatDate(h.createdAt)}
                  </span>
                  <Accordion.Indicator className="size-3.5 text-[var(--muted)] shrink-0" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="px-4 py-3 bg-[var(--default)]/30 text-xs flex flex-col gap-3">
                  <PastGenResult item={h} />
                  {h.field === 'images' && h.expiredAt ? null : (
                    <ApplyToStoreButton
                      jobId={h.jobId}
                      siteId={siteId}
                      initialChange={changeByJobId[h.jobId] ?? null}
                      canApplyToStore={canApplyToStore}
                      disabled={archived}
                      field={h.field}
                      replaceAllImages={replaceAllImages}
                      currentImageCount={currentImageCount}
                      generatedImageCount={generatedImageCount(h)}
                    />
                  )}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Card>
      <ServerPagination
        currentPage={page}
        totalPages={totalPages}
        ariaLabel="Past generations pagination"
        hrefForPage={(p) => `?historyPage=${p}`}
      />
    </section>
  );
}

/** The "m" of the replace-all confirmation: visuals this generation delivered. */
function generatedImageCount(item: OptimHistoryItem): number {
  if (item.field !== 'images' || !Array.isArray(item.output)) return 0;
  return item.output.filter((u) => typeof u === 'string' && u.length > 0).length;
}

function pastGenLabelKey(field: OptimHistoryItem['field']): string {
  switch (field) {
    case 'title':
      return 'jobKindTitle';
    case 'description':
      return 'jobKindDescription';
    case 'tags':
      return 'jobKindTags';
    case 'images':
      return 'jobKindImageEdit';
  }
}

/** Single-line preview shown next to the action label in the collapsed row. */
function pastGenInlinePreview(output: string | string[]): string {
  if (Array.isArray(output)) {
    if (output.length === 0) return '';
    if (typeof output[0] === 'string' && /^https?:\/\//.test(output[0])) {
      return `${output.length} image(s)`;
    }
    return output.slice(0, 5).join(', ');
  }
  if (typeof output === 'string') return stripHtmlPreview(output, 100);
  return '';
}

/**
 * Detail panel: shows ONLY the result. The prompt is intentionally hidden so
 * we don't expose our prompt-engineering wording to merchants.
 */
function PastGenResult({ item }: { item: OptimHistoryItem }) {
  if (item.field === 'images' && Array.isArray(item.output)) {
    const urls = item.output.filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) {
      // Tombstoned by the cleanup worker (or legacy job whose URLs
      // never landed). Render a single placeholder tile via
      // HistoryImage with no URL — the component handles the
      // "broken" state out of the box.
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <HistoryImage url="" />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {urls.slice(0, 6).map((url) => (
          <HistoryImage key={url} url={url} />
        ))}
      </div>
    );
  }
  if (item.field === 'tags' && Array.isArray(item.output)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {item.output.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-mono"
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }
  if (item.field === 'description' && typeof item.output === 'string') {
    // Description is HTML — render it sanitised-style via prose so <p>/<ul>
    // come out properly. Output already comes from kie limited to outputCap
    // but truncate defensively for very long descriptions.
    const html =
      item.output.length > PAST_GEN_DETAIL_LIMIT * 4
        ? `${item.output.slice(0, PAST_GEN_DETAIL_LIMIT * 4)}…`
        : item.output;
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-xs"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (typeof item.output === 'string') {
    return (
      <p className="whitespace-pre-wrap break-words text-[var(--foreground)]">
        {item.output.length > PAST_GEN_DETAIL_LIMIT
          ? `${item.output.slice(0, PAST_GEN_DETAIL_LIMIT).trimEnd()}…`
          : item.output}
      </p>
    );
  }
  return <p className="text-[var(--muted)] italic">—</p>;
}

function stripHtmlPreview(raw: string, max: number): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
