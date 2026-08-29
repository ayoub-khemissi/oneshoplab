import { Accordion, Card } from '@heroui/react';
import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ServerPagination } from '@/components/server-pagination';
import type { JobStatus } from '@/lib/db/schema';
import type { ProjectJobRow } from '@/app/[locale]/dashboard/sites/[siteId]/_lib/types';

export function ProjectJobsList({
  items,
  siteId,
  page,
  totalPages
}: {
  items: ProjectJobRow[];
  siteId: string;
  page: number;
  totalPages: number;
}) {
  const t = useTranslations('Dashboard');
  if (items.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <p className="text-sm opacity-60">{t('noJobs')}</p>
      </section>
    );
  }
  return (
    <Card>
      <Card.Content className="p-0">
        <Accordion>
          {items.map((j) => {
            const productHref = j.product?.id
              ? `/dashboard/sites/${siteId}/products/${j.product.id}`
              : null;
            return (
              <Accordion.Item
                key={j.id}
                id={j.id}
                className="border-b border-[var(--border)] last:border-b-0"
              >
                {/* Mirrors the Past Generations accordion layout —
                    type label (fixed) · product / scope (flex-1
                    truncate) · credits · status · chevron, all
                    inside a single Accordion.Trigger so a click
                    anywhere on the row toggles the detail. */}
                <Accordion.Heading>
                  <Accordion.Trigger className="w-full px-4 py-3 flex items-center gap-3 text-sm text-left hover:bg-[var(--default)]/40 transition-colors">
                    <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium shrink-0 min-w-[7rem]">
                      {t(jobKindLabel(j.kind as never))}
                    </span>
                    <span className="flex-1 truncate text-[var(--muted)] inline-flex items-center gap-1.5 min-w-0">
                      {j.product ? (
                        <>
                          {j.product.status === 'archived' ? (
                            <span
                              className="text-[10px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--muted)]/15 text-[var(--muted)] shrink-0"
                              title={t('jobProductArchived')}
                            >
                              {t('archivedBadgeShort')}
                            </span>
                          ) : null}
                          {productHref ? (
                            // Nested in the trigger — the Link still
                            // navigates on its own click thanks to
                            // event bubbling; HeroUI's Accordion
                            // treats descendant link clicks as
                            // non-toggling.
                            <Link
                              href={productHref}
                              className={`hover:text-[var(--accent)] hover:underline truncate min-w-0 ${
                                j.product.status === 'archived' ? 'italic' : ''
                              }`}
                              title={j.product.title}
                            >
                              {j.product.title}
                            </Link>
                          ) : (
                            <span className="truncate min-w-0">{j.product.title}</span>
                          )}
                        </>
                      ) : (
                        <span
                          className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] shrink-0"
                          title={t('jobScopeSiteWide')}
                        >
                          {t('jobScopeSiteWide')}
                        </span>
                      )}
                    </span>
                    {j.creditsCost > 0 ? (
                      <span className="text-xs text-[var(--muted)] font-mono tabular-nums shrink-0 inline-flex items-center gap-1">
                        <Coins className="size-3" aria-hidden />
                        {j.creditsCost}
                      </span>
                    ) : null}
                    <ProjectJobStatusBadge status={j.status as JobStatus} />
                    <Accordion.Indicator className="size-3.5 text-[var(--muted)] shrink-0" />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="px-4 py-3 bg-[var(--default)]/30 text-xs">
                    <JobDetail job={j} />
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      </Card.Content>
      <ServerPagination
        currentPage={page}
        totalPages={totalPages}
        ariaLabel="Activity pagination"
        hrefForPage={(p) => `?tab=jobs&activityPage=${p}`}
      />
    </Card>
  );
}

const DETAIL_SNIPPET_LIMIT = 320;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function JobDetail({ job }: { job: ProjectJobRow }) {
  const t = useTranslations('Dashboard');
  const result = (job.result ?? null) as {
    output?: string | string[];
    raw?: string;
    persistedUrls?: string[];
    resultUrls?: string[];
  } | null;

  const outputText = renderOutputText(result);
  const hasError = job.status === 'failed' || job.status === 'timed_out';

  // The prompt (input.userPrompt) is intentionally NOT surfaced — exposing
  // it would leak our prompt-engineering scaffolding to merchants. Only the
  // result and any error message are shown.
  return (
    <dl className="flex flex-col gap-3">
      {outputText ? (
        <Section label={t('jobDetailOutput')}>{truncate(outputText, DETAIL_SNIPPET_LIMIT)}</Section>
      ) : null}
      {hasError && job.error ? (
        <Section label={t('jobDetailError')} tone="danger">
          {truncate(job.error, DETAIL_SNIPPET_LIMIT)}
        </Section>
      ) : null}
      {!outputText && !job.error ? (
        <p className="text-[var(--muted)] italic">{t('jobDetailEmpty')}</p>
      ) : null}
    </dl>
  );
}

function Section({
  label,
  children,
  tone = 'default'
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${
          tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Render the user-visible "what changed" string from a job's result blob.
 * Chat jobs store either a string (title/description) or an array of strings
 * (tags). Image jobs store URL arrays — surface their count + first URL so
 * the merchant can spot which generation it was without leaving the tab.
 */
function renderOutputText(
  result: {
    output?: string | string[];
    raw?: string;
    persistedUrls?: string[];
    resultUrls?: string[];
  } | null
): string {
  if (!result) return '';
  if (typeof result.output === 'string') return result.output;
  if (Array.isArray(result.output)) return result.output.join(', ');
  const urls = result.persistedUrls ?? result.resultUrls ?? [];
  if (urls.length > 0) {
    return urls.length === 1 ? urls[0] : `${urls.length} images · ${urls[0]}`;
  }
  return '';
}

/**
 * Translate a raw `jobs.kind` enum value into the i18n key for its
 * user-facing label. Hides the kie vendor name and underscores.
 */
function jobKindLabel(kind: string): string {
  const map: Record<string, string> = {
    audit_run: 'jobKindAudit',
    kie_dynamic_audit: 'jobKindAiSuggestions',
    kie_title: 'jobKindTitle',
    kie_description: 'jobKindDescription',
    kie_tags: 'jobKindTags',
    kie_alt_text: 'jobKindAltText',
    kie_image_edit: 'jobKindImageEdit',
    kie_image_generate: 'jobKindImageGenerate',
    kie_prompt_suggest: 'jobKindPromptSuggest'
  };
  return map[kind] ?? 'jobKindGeneric';
}

function ProjectJobStatusBadge({ status }: { status: JobStatus }) {
  const t = useTranslations('Dashboard');
  const labelKey =
    status === 'pending'
      ? 'jobPending'
      : status === 'running'
        ? 'jobRunning'
        : status === 'completed'
          ? 'jobCompleted'
          : status === 'failed'
            ? 'jobFailed'
            : 'jobTimedOut';
  const color =
    status === 'completed'
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : status === 'failed' || status === 'timed_out'
        ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
        : 'bg-[var(--accent)]/10 text-[var(--accent)]';
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${color}`}>
      {t(labelKey)}
    </span>
  );
}
