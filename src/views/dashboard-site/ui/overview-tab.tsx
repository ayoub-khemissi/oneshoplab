import { Card, Skeleton } from '@heroui/react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  axesValueTiers,
  commentaryTiers,
  statsValueTiers,
  type CommentaryTier
} from '@/entities/audit';
import { InfoHint, type InfoHintTopic } from '@/shared/ui';
import type { ProductInsightLite, Scores, SummaryShape } from '../model/types';

export function OverviewTab({
  scores,
  summary,
  platform,
  siteId,
  productIdByKey
}: {
  scores: Scores;
  summary: SummaryShape;
  platform: string;
  siteId: string;
  productIdByKey: Map<string, string>;
}) {
  const t = useTranslations('Report');
  // Escape hatch: keys are concatenated at runtime (e.g.
  // `commentary.scores.catalog.${tier}`) — next-intl resolves them dynamically
  // but TS can't see through the template literal, so we cast the rich() shape
  // to accept a plain string key + values.
  type RichValues = Record<
    string,
    string | number | ((chunks: React.ReactNode) => React.ReactNode)
  >;
  const tRich = t.rich as unknown as (key: string, values: RichValues) => React.ReactNode;

  const scoreColor = (tier: CommentaryTier) =>
    tier === 'good'
      ? 'text-[var(--success)]'
      : tier === 'mid'
        ? 'text-[var(--warning)]'
        : 'text-[var(--danger)]';

  const richTags = (tier: CommentaryTier): RichValues => ({
    score: (chunks: React.ReactNode) => (
      <span className={`font-semibold ${scoreColor(tier)}`}>{chunks}</span>
    ),
    strong: (chunks: React.ReactNode) => (
      <strong className="font-semibold text-[var(--foreground)]">{chunks}</strong>
    )
  });

  const tiers = commentaryTiers(scores);
  const axes = axesValueTiers(scores);

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const avgScore = Math.round(summary.avgProductScore ?? 0);
  const avgImages = round1(summary.averages?.imageCount ?? 0);
  const avgDescLength = Math.round(summary.averages?.descriptionLength ?? 0);
  const avgTags = round1(summary.averages?.tagCount ?? 0);
  const noImage = summary.distribution?.imagesZero ?? 0;
  const noDesc = summary.distribution?.descEmpty ?? 0;

  const stats = statsValueTiers({ avgScore, avgImages, avgDescLength, avgTags });

  const overallText = tRich(`commentary.overall.${tiers.overall}`, richTags(tiers.overall));

  const scoresItems: React.ReactNode[] = [
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

  const statsItems: React.ReactNode[] = [
    tRich(`commentary.stats.avgScore.${stats.avgScore}`, {
      ...richTags(stats.avgScore),
      value: avgScore
    }),
    tRich(`commentary.stats.avgImages.${stats.avgImages}`, {
      ...richTags(stats.avgImages),
      value: avgImages
    }),
    tRich(`commentary.stats.avgDescLength.${stats.avgDescLength}`, {
      ...richTags(stats.avgDescLength),
      value: avgDescLength
    }),
    tRich(`commentary.stats.avgTags.${stats.avgTags}`, {
      ...richTags(stats.avgTags),
      value: avgTags
    }),
    tRich(`commentary.stats.productsNoImage.${noImage > 0 ? 'some' : 'none'}`, {
      ...richTags(noImageTier),
      count: noImage
    }),
    tRich(`commentary.stats.productsNoDesc.${noDesc > 0 ? 'some' : 'none'}`, {
      ...richTags(noDescTier),
      count: noDesc
    })
  ];

  return (
    <>
      <HeroScore scores={scores} platform={platform} summary={summary} />
      <ScoreCommentary tier={tiers.overall} content={overallText} />
      <ScoresGrid scores={scores} />
      <ScoreCommentary tier={tiers.axes} items={scoresItems} />
      <SummaryHints summary={summary} />
      <ScoreCommentary tier={tiers.stats} items={statsItems} />
      <WorstProductsQuickList
        products={summary.worstProducts ?? []}
        siteId={siteId}
        productIdByKey={productIdByKey}
      />
    </>
  );
}

function WorstProductsQuickList({
  products,
  siteId,
  productIdByKey
}: {
  products: ProductInsightLite[];
  siteId: string;
  productIdByKey: Map<string, string>;
}) {
  const t = useTranslations('Dashboard');
  // Show only the bottom 5 — Aperçu is meant to surface the most actionable
  // items without crowding the page. The "Produits" tab has the full catalog.
  const top = products.slice(0, 5);
  if (top.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('worstSection')}</h2>
      <Card>
        <Card.Content className="p-0 divide-y divide-[var(--border)]">
          {top.map((p) => {
            const productId =
              productIdByKey.get(p.sourceId ?? '') ?? productIdByKey.get(p.handle ?? '') ?? null;
            const href = productId ? `/dashboard/sites/${siteId}/products/${productId}` : null;
            const category = p.signals?.productType?.trim() || null;
            return (
              <div
                key={productId ?? p.sourceId ?? p.handle ?? p.title}
                className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <WorstScoreChip score={p.score} />
                  <span className="truncate">{p.title}</span>
                  {category ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] border border-[var(--border)] truncate max-w-[10rem] shrink-0"
                      title={category}
                    >
                      {category}
                    </span>
                  ) : null}
                </div>
                {href ? (
                  <Link
                    href={href}
                    className="shrink-0 px-3 py-1.5 text-xs rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity whitespace-nowrap font-medium inline-flex items-center gap-1.5"
                  >
                    {t('siteCardOpen')}
                    <ArrowLeft className="size-3.5 -scale-x-100" />
                  </Link>
                ) : null}
              </div>
            );
          })}
        </Card.Content>
      </Card>
    </section>
  );
}

function WorstScoreChip({ score }: { score: number }) {
  const tone =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded font-semibold shrink-0 ${tone}`}>
      {score}/100
    </span>
  );
}

function ScoreCommentary({
  tier,
  content,
  items
}: {
  tier: CommentaryTier;
  content?: React.ReactNode;
  items?: React.ReactNode[];
}) {
  const borderColor =
    tier === 'good'
      ? 'border-l-[var(--success)]'
      : tier === 'mid'
        ? 'border-l-[var(--warning)]'
        : 'border-l-[var(--danger)]';
  const base = `text-sm leading-relaxed text-[var(--muted)] border-l-2 pl-4 -mt-2 ${borderColor}`;

  if (items && items.length > 0) {
    return (
      <ul className={`${base} flex flex-col gap-2`}>
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1 rounded-full bg-current opacity-50 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  return <p className={base}>{content}</p>;
}

function HeroScore({
  scores,
  platform,
  summary
}: {
  scores: Scores;
  platform: string;
  summary: SummaryShape;
}) {
  const t = useTranslations('Report');
  const ringColor =
    scores.overall >= 75
      ? 'border-[var(--success)]'
      : scores.overall >= 50
        ? 'border-[var(--warning)]'
        : 'border-[var(--danger)]';
  return (
    <Card
      variant="tertiary"
      data-tour="site-score"
      className="p-8 flex flex-col md:flex-row items-center gap-8"
    >
      <div
        className={`score-ring w-36 h-36 rounded-full border-8 ${ringColor} flex items-center justify-center flex-shrink-0`}
      >
        <div className="text-center">
          <div className="text-4xl font-bold">{scores.overall}</div>
          <div className="text-xs text-[var(--muted)] uppercase tracking-wide">/ 100</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-center md:text-left">
        <h2 className="inline-flex items-center justify-center gap-2 text-2xl font-bold tracking-tight md:justify-start">
          {t('overallScore')}
          <InfoHint topic="score.overall" label={t('overallScore')} size="md" />
        </h2>
        <p className="text-sm text-[var(--muted)]">{t('overallSubtitle', { platform })}</p>
        <DataSourceLine summary={summary} />
      </div>
    </Card>
  );
}

/** Where the score came from. A merchant who connected their store must be
 *  able to tell at a glance that the report reflects the catalog they synced
 *  and not a public scrape — and how old that catalog is. */
function DataSourceLine({ summary }: { summary: SummaryShape }) {
  const t = useTranslations('Report');
  if (summary.source !== 'connection') {
    return <p className="text-xs text-[var(--muted)] opacity-80">{t('dataSource.storefront')}</p>;
  }
  const syncedAt = summary.catalogSyncedAt ? new Date(summary.catalogSyncedAt) : null;
  const label =
    syncedAt && !Number.isNaN(syncedAt.getTime())
      ? t('dataSource.connection', { ago: relativeAgo(nowMs() - syncedAt.getTime(), t) })
      : t('dataSource.connectionNoSync');
  return <p className="text-xs text-[var(--muted)] opacity-80">{label}</p>;
}

/** Read outside the render expression so the "how long ago" formatting stays
 *  a plain function of its inputs. */
function nowMs(): number {
  return Date.now();
}

function relativeAgo(
  elapsedMs: number,
  t: (
    key:
      | 'dataSource.ago.seconds'
      | 'dataSource.ago.minutes'
      | 'dataSource.ago.hours'
      | 'dataSource.ago.days',
    v: { n: number }
  ) => string
): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 60) return t('dataSource.ago.seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('dataSource.ago.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('dataSource.ago.hours', { n: h });
  return t('dataSource.ago.days', { n: Math.floor(h / 24) });
}

function ScoresGrid({ scores }: { scores: Scores }) {
  const t = useTranslations('Dashboard');
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('scoresSection')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ScoreTile
          label={t('scoreCatalog')}
          topic="score.catalogCompleteness"
          value={scores.catalogCompleteness}
        />
        <ScoreTile label={t('scoreCopy')} topic="score.copyQuality" value={scores.copyQuality} />
        <ScoreTile
          label={t('scoreVisual')}
          topic="score.visualQuality"
          value={scores.visualQuality}
        />
        <ScoreTile
          label={t('scoreTagging')}
          topic="score.taggingQuality"
          value={scores.taggingQuality}
        />
      </div>
    </section>
  );
}

function ScoreTile({
  label,
  topic,
  value
}: {
  label: string;
  topic: InfoHintTopic;
  value: number;
}) {
  const accent =
    value >= 75
      ? 'text-[var(--success)]'
      : value >= 50
        ? 'text-[var(--warning)]'
        : 'text-[var(--danger)]';
  return (
    <Card variant="secondary" className="p-4">
      <div className="inline-flex items-center gap-1.5 text-xs uppercase text-[var(--muted)] tracking-wide">
        {label}
        <InfoHint topic={topic} label={label} />
      </div>
      <div className={`text-3xl font-bold mt-1 ${accent}`}>
        {value}
        <span className="text-xs text-[var(--muted)]"> / 100</span>
      </div>
    </Card>
  );
}

function SummaryHints({ summary }: { summary: SummaryShape }) {
  const t = useTranslations('Report');
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('quickStats')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label={t('avgScore')} value={`${summary.avgProductScore ?? '—'} / 100`} />
        <Stat
          label={t('avgImages')}
          topic="imageCount"
          value={String(summary.averages?.imageCount ?? '—')}
        />
        <Stat
          label={t('avgDescLength')}
          value={`${summary.averages?.descriptionLength ?? '—'} chars`}
        />
        <Stat label={t('avgTags')} value={String(summary.averages?.tagCount ?? '—')} />
        <Stat label={t('productsNoImage')} value={String(summary.distribution?.imagesZero ?? 0)} />
        <Stat label={t('productsNoDesc')} value={String(summary.distribution?.descEmpty ?? 0)} />
      </div>
    </section>
  );
}

function Stat({ label, topic, value }: { label: string; topic?: InfoHintTopic; value: string }) {
  return (
    <Card variant="secondary" className="p-3">
      <div className="inline-flex items-center gap-1.5 text-xs uppercase text-[var(--muted)] tracking-wide">
        {label}
        {topic ? <InfoHint topic={topic} label={label} /> : null}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </Card>
  );
}

function ConversionCta() {
  const t = useTranslations('Report');
  return (
    <Card variant="tertiary" className="p-6 flex flex-col md:flex-row items-center gap-6">
      <div className="flex-1 flex flex-col gap-1">
        <h3 className="text-xl font-bold">{t('ctaTitle')}</h3>
        <p className="text-sm text-[var(--muted)]">{t('ctaSubtitle')}</p>
      </div>
      <Link
        href="/signup"
        className="px-5 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 font-medium whitespace-nowrap transition-opacity"
      >
        {t('ctaButton')}
      </Link>
    </Card>
  );
}

export function StaticSkeleton() {
  return (
    <>
      <Card variant="tertiary" className="p-8 flex flex-col md:flex-row items-center gap-8">
        <Skeleton className="w-36 h-36 rounded-full flex-shrink-0" />
        <div className="flex flex-col gap-3 w-full md:w-auto md:min-w-[280px]">
          <Skeleton className="h-7 w-48 rounded" />
          <Skeleton className="h-4 w-full max-w-xs rounded" />
        </div>
      </Card>
      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24 rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} variant="secondary" className="p-4 flex flex-col gap-2">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-9 w-24 rounded" />
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
