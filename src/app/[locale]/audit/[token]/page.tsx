import { Card } from '@heroui/react';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Loader2,
  Sparkles
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/auto-refresh';
import { Link } from '@/i18n/navigation';
import {
  axesValueTiers,
  commentaryTiers,
  statsValueTiers,
  type CommentaryTier
} from '@/lib/audit/commentary';
import { db } from '@/lib/db';
import { audits } from '@/lib/db/schema';
import { translateIssueText } from '@/lib/share/issue-text';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

interface AuditScores {
  catalogCompleteness: number;
  copyQuality: number;
  visualQuality: number;
  taggingQuality: number;
  overall: number;
}

interface InsightLite {
  title: string;
  score: number;
  url?: string | null;
  sourceId?: string | null;
  handle?: string | null;
  issues?: Array<{ code: string; data?: Record<string, string | number> }>;
  signals?: { productType?: string | null };
}

interface SummaryShape {
  avgProductScore?: number;
  averages?: {
    imageCount?: number;
    descriptionLength?: number;
    tagCount?: number;
  };
  distribution?: {
    imagesZero?: number;
    descEmpty?: number;
    tagsZero?: number;
    altNone?: number;
  };
  worstProducts?: InsightLite[];
  allProducts?: InsightLite[];
}

// next-intl resolves keys built at runtime (e.g.
// `commentary.scores.catalog.${tier}`) fine, but TS can't see through
// the template literal — cast rich() to a plain string-key signature.
type RichValues = Record<
  string,
  string | number | ((chunks: ReactNode) => ReactNode)
>;

const MAX_WORST = 12;

async function loadAnonAudit(token: string) {
  // anon_token is indexed; the projectId IS NULL guard makes sure a
  // claimed (now user-owned) audit can't be reopened via its old token.
  return db.query.audits.findFirst({
    where: and(eq(audits.anonToken, token), isNull(audits.projectId))
  });
}

/**
 * Per-visitor result page — noindex/nofollow (mirrors /share/[token]).
 * Only the /audit form page is the canonical, indexable SEO asset;
 * these token URLs must never land in the index.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const audit = await loadAnonAudit(token);
  return {
    title: audit ? `${audit.domain} — audit` : 'Audit',
    robots: { index: false, follow: false },
    alternates: { canonical: undefined }
  };
}

function ScoreBox({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 75
      ? 'text-[var(--success)]'
      : value >= 50
        ? 'text-[var(--warning)]'
        : 'text-[var(--danger)]';
  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-[var(--background)] border border-[var(--border)]">
      <span className="text-xs text-[var(--muted)] uppercase tracking-wider font-mono">
        {label}
      </span>
      <span className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-md bg-[var(--background)] border border-[var(--border)]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-mono">
        {label}
      </div>
      <div className="text-base font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

/** Tier-coloured commentary block — paragraph or bullet list. Mirrors
 *  the dashboard's ScoreCommentary so the public audit reads the same. */
function Commentary({
  tier,
  content,
  items
}: {
  tier: CommentaryTier;
  content?: ReactNode;
  items?: ReactNode[];
}) {
  const border =
    tier === 'good'
      ? 'border-l-[var(--success)]'
      : tier === 'mid'
        ? 'border-l-[var(--warning)]'
        : 'border-l-[var(--danger)]';
  const base = `text-sm leading-relaxed text-[var(--muted)] border-l-2 pl-4 ${border}`;
  if (items && items.length > 0) {
    return (
      <ul className={`${base} flex flex-col gap-2`}>
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-2 size-1 rounded-full bg-current opacity-50 shrink-0"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className={base}>{content}</p>;
}

function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span
      className={`text-xs font-mono px-2 py-0.5 rounded font-semibold shrink-0 ${tone}`}
    >
      {score}/100
    </span>
  );
}

export default async function FreeAuditResultPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const audit = await loadAnonAudit(token);
  if (!audit) notFound();

  const t = await getTranslations('FreeAudit');
  const tShare = await getTranslations('Share');
  const tReport = await getTranslations('Report');
  const tIssues = await getTranslations('Issues');
  const domain = audit.domain ?? '';
  const platform = audit.platform && audit.platform !== 'unknown'
    ? audit.platform
    : 'your platform';

  // --- In progress ---------------------------------------------------------
  if (audit.status === 'pending' || audit.status === 'running') {
    return (
      <main className="flex-1 px-4 md:px-10 py-16 max-w-2xl w-full mx-auto flex flex-col items-center gap-6 text-center">
        <AutoRefresh />
        <Loader2 className="size-10 text-[var(--accent)] animate-spin" aria-hidden />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {t('runningTitle', { domain })}
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-md leading-relaxed">
          {t('runningBody')}
        </p>
      </main>
    );
  }

  // --- Failed --------------------------------------------------------------
  if (audit.status === 'failed') {
    return (
      <main className="flex-1 px-4 md:px-10 py-16 max-w-2xl w-full mx-auto flex flex-col items-center gap-6 text-center">
        <AlertTriangle className="size-10 text-[var(--danger)]" aria-hidden />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {t('failedTitle')}
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-md leading-relaxed">
          {t('failedBody')}
        </p>
        <Link
          href="/audit"
          className="px-4 py-2 rounded-md text-sm font-medium border border-[var(--border)] hover:border-[var(--accent)] inline-flex items-center gap-1.5"
        >
          {t('retry')}
          <ArrowRight className="size-3.5" />
        </Link>
      </main>
    );
  }

  // --- Completed -----------------------------------------------------------
  const scores = (audit.scores as AuditScores | null) ?? null;
  const summary = (audit.summary as SummaryShape | null) ?? null;

  return (
    <main className="flex-1 px-4 md:px-10 py-6 md:py-10 max-w-4xl w-full mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <span className="eyebrow self-center">{t('resultEyebrow')}</span>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight [overflow-wrap:anywhere]">
          {domain}
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-xl mx-auto leading-relaxed">
          {t('resultSubtitle', { domain })}
        </p>
      </header>

      {scores ? (
        (() => {
          // Tier helpers + rich-text chunk handlers (server-side
          // getTranslations exposes .rich just like the client hook).
          const tRich = tReport.rich as unknown as (
            key: string,
            values: RichValues
          ) => ReactNode;
          const scoreColor = (tier: CommentaryTier) =>
            tier === 'good'
              ? 'text-[var(--success)]'
              : tier === 'mid'
                ? 'text-[var(--warning)]'
                : 'text-[var(--danger)]';
          const richTags = (tier: CommentaryTier): RichValues => ({
            score: (chunks: ReactNode) => (
              <span className={`font-semibold ${scoreColor(tier)}`}>{chunks}</span>
            ),
            strong: (chunks: ReactNode) => (
              <strong className="font-semibold text-[var(--foreground)]">
                {chunks}
              </strong>
            )
          });

          const round1 = (n: number) => Math.round(n * 10) / 10;
          const avgScore = Math.round(summary?.avgProductScore ?? 0);
          const avgImages = round1(summary?.averages?.imageCount ?? 0);
          const avgDescLength = Math.round(
            summary?.averages?.descriptionLength ?? 0
          );
          const avgTags = round1(summary?.averages?.tagCount ?? 0);
          const noImage = summary?.distribution?.imagesZero ?? 0;
          const noDesc = summary?.distribution?.descEmpty ?? 0;
          const noTags = summary?.distribution?.tagsZero ?? 0;
          const noAlt = summary?.distribution?.altNone ?? 0;

          const tiers = commentaryTiers(scores);
          const axes = axesValueTiers(scores);
          const statsT = statsValueTiers({
            avgScore,
            avgImages,
            avgDescLength,
            avgTags
          });

          const overallText = tRich(
            `commentary.overall.${tiers.overall}`,
            richTags(tiers.overall)
          );
          const scoresItems: ReactNode[] = [
            tRich(`commentary.scores.catalog.${axes.catalog}`, {
              ...richTags(axes.catalog),
              value: scores.catalogCompleteness
            }),
            tRich(`commentary.scores.copy.${axes.copy}`, {
              ...richTags(axes.copy),
              value: scores.copyQuality
            }),
            tRich(`commentary.scores.visual.${axes.visual}`, {
              ...richTags(axes.visual),
              value: scores.visualQuality
            }),
            tRich(`commentary.scores.tagging.${axes.tagging}`, {
              ...richTags(axes.tagging),
              value: scores.taggingQuality
            })
          ];
          const noImageTier: CommentaryTier = noImage > 0 ? 'poor' : 'good';
          const noDescTier: CommentaryTier = noDesc > 0 ? 'poor' : 'good';
          const statsItems: ReactNode[] = [
            tRich(`commentary.stats.avgScore.${statsT.avgScore}`, {
              ...richTags(statsT.avgScore),
              value: avgScore
            }),
            tRich(`commentary.stats.avgImages.${statsT.avgImages}`, {
              ...richTags(statsT.avgImages),
              value: avgImages
            }),
            tRich(`commentary.stats.avgDescLength.${statsT.avgDescLength}`, {
              ...richTags(statsT.avgDescLength),
              value: avgDescLength
            }),
            tRich(`commentary.stats.avgTags.${statsT.avgTags}`, {
              ...richTags(statsT.avgTags),
              value: avgTags
            }),
            tRich(
              `commentary.stats.productsNoImage.${noImage > 0 ? 'some' : 'none'}`,
              { ...richTags(noImageTier), count: noImage }
            ),
            tRich(
              `commentary.stats.productsNoDesc.${noDesc > 0 ? 'some' : 'none'}`,
              { ...richTags(noDescTier), count: noDesc }
            )
          ];

          // Products to optimize: worstProducts first, fall back to the
          // full list sorted worst-first for legacy summaries.
          const allScored =
            summary?.allProducts ?? summary?.worstProducts ?? [];
          const worst = (
            summary?.worstProducts && summary.worstProducts.length > 0
              ? summary.worstProducts
              : [...allScored].sort((a, b) => a.score - b.score)
          ).slice(0, MAX_WORST);
          const totalScored =
            summary?.allProducts?.length ?? audit.productsSampled ?? worst.length;
          const moreCount = Math.max(0, totalScored - worst.length);

          return (
            <>
              {/* Overall score + breakdown ------------------------------- */}
              <Card variant="secondary" className="p-6 flex flex-col gap-5">
                <div className="flex flex-col items-center gap-2">
                  <span className="eyebrow">{tShare('overallScore')}</span>
                  <span className="text-6xl font-bold tabular-nums">
                    {scores.overall}
                    <span className="text-2xl text-[var(--muted)] font-normal">
                      /100
                    </span>
                  </span>
                </div>
                <Commentary tier={tiers.overall} content={overallText} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <ScoreBox
                    label={tShare('axisCatalog')}
                    value={scores.catalogCompleteness}
                  />
                  <ScoreBox label={tShare('axisCopy')} value={scores.copyQuality} />
                  <ScoreBox
                    label={tShare('axisVisual')}
                    value={scores.visualQuality}
                  />
                  <ScoreBox
                    label={tShare('axisTagging')}
                    value={scores.taggingQuality}
                  />
                </div>
                <Commentary tier={tiers.axes} items={scoresItems} />
              </Card>

              {/* How the audit works ------------------------------------- */}
              <Card variant="tertiary" className="p-6 flex flex-col gap-2">
                <h2 className="text-lg font-bold tracking-tight">
                  {t('explainTitle')}
                </h2>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  {t('explainBody', { platform })}
                </p>
              </Card>

              {/* Catalog stats ------------------------------------------- */}
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">{tReport('quickStats')}</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat
                    label={tReport('avgScore')}
                    value={`${avgScore} / 100`}
                  />
                  <Stat
                    label={tReport('avgImages')}
                    value={avgImages.toFixed(1)}
                  />
                  <Stat
                    label={tReport('avgDescLength')}
                    value={`${avgDescLength} ${tShare('detailCharsSuffix')}`}
                  />
                  <Stat label={tReport('avgTags')} value={avgTags.toFixed(1)} />
                  <Stat
                    label={tReport('productsNoImage')}
                    value={String(noImage)}
                  />
                  <Stat
                    label={tReport('productsNoDesc')}
                    value={String(noDesc)}
                  />
                  <Stat
                    label={tShare('detailProductsNoTags')}
                    value={String(noTags)}
                  />
                  <Stat
                    label={tShare('detailProductsNoAlt')}
                    value={String(noAlt)}
                  />
                </div>
                <Commentary tier={tiers.stats} items={statsItems} />
              </section>

              {/* Products to optimize ------------------------------------ */}
              {worst.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h2 className="text-2xl font-bold tracking-tight">
                    {t('productsTitle')}
                  </h2>
                  <p className="text-sm text-[var(--muted)] leading-relaxed max-w-2xl">
                    {t('productsHint')}
                  </p>
                  <Card>
                    <Card.Content className="p-0 divide-y divide-[var(--border)]">
                      {worst.map((p, idx) => {
                        const category = p.signals?.productType?.trim() || null;
                        const issues = (p.issues ?? [])
                          .map((i) => translateIssueText(tIssues, i))
                          .join(' · ');
                        return (
                          <div
                            key={p.sourceId ?? p.handle ?? `${idx}-${p.title}`}
                            className="px-4 py-3 flex flex-col gap-1.5 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-xs font-mono text-[var(--muted)] shrink-0 w-5 text-right">
                                  {idx + 1}
                                </span>
                                <ScoreChip score={p.score} />
                                <span className="truncate font-medium">
                                  {p.title}
                                </span>
                                {category ? (
                                  <span
                                    className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] border border-[var(--border)] truncate max-w-[9rem] shrink-0"
                                    title={category}
                                  >
                                    {category}
                                  </span>
                                ) : null}
                              </div>
                              {p.url ? (
                                <a
                                  href={p.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1"
                                >
                                  {t('viewProduct')}
                                  <ExternalLink className="size-3" aria-hidden />
                                </a>
                              ) : null}
                            </div>
                            {issues ? (
                              <p className="text-xs text-[var(--muted)] leading-relaxed pl-[2.75rem]">
                                <span className="text-[var(--foreground)] font-medium">
                                  {tShare('detailIssuesLabel')}:
                                </span>{' '}
                                {issues}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </Card.Content>
                  </Card>
                  {moreCount > 0 ? (
                    <p className="text-xs text-[var(--muted)] text-center">
                      {t('moreProducts', { count: moreCount })}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </>
          );
        })()
      ) : (
        <Card
          variant="secondary"
          className="p-6 text-center text-sm text-[var(--muted)]"
        >
          {t('noScores')}
        </Card>
      )}

      {/* Sign-up gate: the score + detail are free, the AI before/after
          (rewrites, generated images, social posts) is not. */}
      <Card
        variant="tertiary"
        className="p-6 flex flex-col items-center gap-3 text-center"
      >
        <Sparkles className="size-6 text-[var(--accent)]" aria-hidden />
        <h2 className="text-xl font-bold tracking-tight">{t('ctaTitle')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-xl leading-relaxed">
          {t('ctaBody')}
        </p>
        <div className="flex items-center gap-3 mt-2 flex-wrap justify-center">
          <Link
            href="/signup"
            className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 inline-flex items-center gap-1.5"
          >
            {t('ctaPrimary')}
            <ArrowRight className="size-3.5" />
          </Link>
          <Link
            href="/pricing"
            className="px-4 py-2 rounded-md text-sm font-medium border border-[var(--border)] hover:border-[var(--accent)]"
          >
            {t('ctaSecondary')}
          </Link>
        </div>
      </Card>
    </main>
  );
}
