import { Card, Skeleton } from '@heroui/react';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { notFound, redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { PaginatedProductsList } from '@/components/paginated-products-list';
import { ScrollAwareSticky } from '@/components/scroll-aware-sticky';
import {
  axesValueTiers,
  commentaryTiers,
  statsValueTiers,
  type CommentaryTier
} from '@/lib/audit';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { audits, jobs, products, projects, type JobStatus } from '@/lib/db/schema';
import { sanitizeUserFacingError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Tab = 'overview' | 'products' | 'jobs';

interface PageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

interface Scores {
  catalogCompleteness: number;
  copyQuality: number;
  visualQuality: number;
  taggingQuality: number;
  overall: number;
}

interface ProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface ProductInsightLite {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  descriptionHtml: string;
  images: ProductImage[];
  score: number;
  signals?: { tags?: string[] };
}

interface IssuePayload {
  code: string;
  data?: Record<string, string | number>;
}

interface PaginatedProductPayload {
  sourceId: string | null;
  handle: string | null;
  title: string;
  url: string | null;
  score: number;
  issues: IssuePayload[];
}

interface PaginatedProductWithId extends PaginatedProductPayload {
  productId: string;
}

interface SummaryShape {
  avgProductScore?: number;
  averages?: {
    imageCount?: number;
    descriptionLength?: number;
    tagCount?: number;
    titleLength?: number;
  };
  distribution?: {
    altNone?: number;
    altPartial?: number;
    altFull?: number;
    imagesZero?: number;
    descEmpty?: number;
    descShortLt100?: number;
  };
  latestProducts?: ProductInsightLite[];
  worstProducts?: ProductInsightLite[];
  allProducts?: PaginatedProductPayload[];
  detectedLanguage?: string | null;
}

export default async function ReportPage({ params, searchParams }: PageProps) {
  const { siteId } = await params;
  const { tab: rawTab } = await searchParams;
  const activeTab: Tab =
    rawTab === 'products' ? 'products' : rawTab === 'jobs' ? 'jobs' : 'overview';

  // Reports are owner-only. Anonymous visitors get bounced to /login;
  // logged-in users who don't own this project get sent to their dashboard.
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/sites/${siteId}`)}`);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, siteId)
  });
  if (!project || project.userId !== session.user.id) {
    redirect('/dashboard');
  }

  // Primary key: projectId. Fall back to matching by domain for legacy
  // audits that were inserted before the projects/audits FK was wired up
  // (their projectId is NULL).
  const audit = await db.query.audits.findFirst({
    where: or(
      eq(audits.projectId, project.id),
      and(isNull(audits.projectId), eq(audits.domain, project.domain ?? ''))
    ),
    orderBy: [desc(audits.createdAt)]
  });
  if (!audit) notFound();

  const summary = (audit.summary ?? {}) as SummaryShape;
  const decoded = project.domain ?? project.name;

  const { touchProjectLastView } = await import('@/lib/auth-actions');
  const { refreshProjectIfStale } = await import('@/lib/audit');
  await touchProjectLastView(project.id);
  void refreshProjectIfStale(project.id).catch((e) =>
    console.error('[sites page auto-refresh]', e)
  );

  // Site quota — drives the conditional Add-site button. Back-to-dashboard
  // is always visible now that we navigate via the hub (no auto-redirect).
  const { siteLimitForPlan } = await import('@/lib/ai/models');
  const userSites = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    columns: { id: true }
  });
  const siteLimit = siteLimitForPlan(session.user.plan);
  const canAddSite = userSites.length < siteLimit;

  // Pull every product row so we can map the audit-summary's denormalized
  // snapshot (sourceId/handle) onto the actual `products.id` UUID — that's
  // what the URLs use now (avoids slug collisions and encoding pitfalls).
  // Plus the project's job history for the Activity tab.
  const [initialProductRows, projectJobs] = await Promise.all([
    db.query.products.findMany({
      where: eq(products.projectId, project.id),
      columns: { id: true, sourceId: true, handle: true }
    }),
    db.query.jobs.findMany({
      where: eq(jobs.projectId, project.id),
      orderBy: [desc(jobs.createdAt)],
      limit: 30,
      with: {
        product: {
          columns: { id: true, sourceId: true, handle: true, title: true }
        }
      }
    })
  ]);

  // Backfill: legacy audits never inserted into the products table (the
  // pipeline only wrote `audits.summary`). On first visit after the refactor,
  // hydrate the table from the summary so the per-product UUID URLs resolve.
  let productRows = initialProductRows;
  const summaryAll = summary.allProducts ?? [];
  if (
    productRows.length === 0 &&
    summaryAll.length > 0 &&
    audit.platform !== null
  ) {
    const { randomUUID } = await import('node:crypto');
    const inserted = summaryAll
      .filter((p) => p.sourceId || p.handle)
      .map((p) => ({
        id: randomUUID(),
        projectId: project.id,
        source: audit.platform!,
        sourceId: p.sourceId,
        sourceUrl: p.url,
        handle: p.handle,
        title: p.title
      }));
    if (inserted.length > 0) {
      await db.insert(products).values(inserted);
      productRows = inserted.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        handle: r.handle
      }));
    }
  }

  const productIdByKey = new Map<string, string>();
  for (const p of productRows) {
    if (p.sourceId) productIdByKey.set(p.sourceId, p.id);
    if (p.handle) productIdByKey.set(p.handle, p.id);
  }

  const allProductsWithIds: PaginatedProductWithId[] = (summary.allProducts ?? [])
    .map((p) => {
      const key = p.sourceId ?? p.handle ?? '';
      const productId = productIdByKey.get(key);
      return productId ? { ...p, productId } : null;
    })
    .filter((p): p is PaginatedProductWithId => p !== null);

  const hasUnfinishedJobs = projectJobs.some(
    (j) => j.status === 'pending' || j.status === 'running'
  );
  const auditLoading = audit.status === 'pending' || audit.status === 'running';
  const isLoading = auditLoading || hasUnfinishedJobs;

  return (
    <main className="flex-1 p-6 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-8">
      {isLoading ? <AutoRefresh /> : null}

      <ScrollAwareSticky topOffsetPx={68}>
        <SiteHeaderBar
          domain={decoded}
          url={audit.url}
          canAdd={canAddSite}
        />
        <StatusLine status={audit.status} error={audit.error} />
        <TabsNav active={activeTab} siteId={siteId} />
      </ScrollAwareSticky>

      {activeTab === 'overview' ? (
        auditLoading ? (
          <StaticSkeleton />
        ) : audit.status === 'completed' && audit.scores != null ? (
          <OverviewTab
            scores={audit.scores as Scores}
            summary={summary}
            platform={audit.platform}
            siteId={siteId}
            productIdByKey={productIdByKey}
          />
        ) : null
      ) : activeTab === 'products' ? (
        <PaginatedProductsList
          siteId={siteId}
          products={allProductsWithIds}
        />
      ) : (
        <ProjectJobsList items={projectJobs as ProjectJobRow[]} siteId={siteId} />
      )}
    </main>
  );
}

// ==========================================================================
// Header + Tabs
// ==========================================================================

function SiteHeaderBar({
  domain,
  url,
  canAdd
}: {
  domain: string;
  url: string;
  canAdd: boolean;
}) {
  const t = useTranslations('Dashboard');
  return (
    <header className="flex items-center justify-between gap-3 flex-wrap">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {t('backToDashboard')}
      </Link>
      <div className="flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-semibold hover:text-[var(--accent)] transition-colors"
        >
          {domain}
          <ExternalLink className="size-4 opacity-60" aria-hidden />
        </a>
        {canAdd ? (
          <Link
            href="/dashboard/sites/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium"
          >
            <Plus className="size-3.5" />
            {t('addSite')}
          </Link>
        ) : null}
      </div>
    </header>
  );
}

function StatusLine({ status, error }: { status: string; error: string | null }) {
  const t = useTranslations('Report');
  if (status === 'pending') {
    return (
      <p className="text-sm text-[var(--muted)] flex items-center gap-2">
        <PulsingDot /> {t('queued')}
      </p>
    );
  }
  if (status === 'running') {
    return (
      <p className="text-sm text-[var(--muted)] flex items-center gap-2">
        <PulsingDot /> {t('running')}
      </p>
    );
  }
  if (status === 'failed')
    return (
      <p role="alert" className="text-sm text-[var(--danger)]">
        {t('failed', { error: sanitizeUserFacingError(error) })}
      </p>
    );
  return null;
}

function PulsingDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]" />
    </span>
  );
}

function TabsNav({ active, siteId }: { active: Tab; siteId: string }) {
  const t = useTranslations('Dashboard');
  return (
    <nav className="border-b border-[var(--border)] flex gap-1 -mt-2 overflow-x-auto">
      <TabLink
        href={`/dashboard/sites/${siteId}`}
        active={active === 'overview'}
        label={t('tabOverview')}
      />
      <TabLink
        href={`/dashboard/sites/${siteId}?tab=products`}
        active={active === 'products'}
        label={t('tabProducts')}
      />
      <TabLink
        href={`/dashboard/sites/${siteId}?tab=jobs`}
        active={active === 'jobs'}
        label={t('tabJobs')}
      />
    </nav>
  );
}

function TabLink({
  href,
  active,
  label,
  badge
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: string;
}) {
  const base =
    'px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-[padding,font-size,line-height] duration-200 group-data-[compact=true]/sticky:px-2.5 group-data-[compact=true]/sticky:py-1.5 group-data-[compact=true]/sticky:text-xs';
  const state = active
    ? 'border-[var(--accent)] text-[var(--foreground)]'
    : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]';
  return (
    <Link href={href} className={`${base} ${state}`}>
      {label}
      {badge && (
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
          {badge}
        </span>
      )}
    </Link>
  );
}

// ==========================================================================
// Static Analysis tab
// ==========================================================================

function OverviewTab({
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
      <HeroScore scores={scores} platform={platform} />
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
              productIdByKey.get(p.sourceId ?? '') ??
              productIdByKey.get(p.handle ?? '') ??
              null;
            const href = productId
              ? `/dashboard/sites/${siteId}/products/${productId}`
              : null;
            return (
              <div
                key={productId ?? p.sourceId ?? p.handle ?? p.title}
                className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <WorstScoreChip score={p.score} />
                  <span className="truncate">{p.title}</span>
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

function HeroScore({ scores, platform }: { scores: Scores; platform: string }) {
  const t = useTranslations('Report');
  const ringColor =
    scores.overall >= 75
      ? 'border-[var(--success)]'
      : scores.overall >= 50
        ? 'border-[var(--warning)]'
        : 'border-[var(--danger)]';
  return (
    <Card variant="tertiary" className="p-8 flex flex-col md:flex-row items-center gap-8">
      <div
        className={`score-ring w-36 h-36 rounded-full border-8 ${ringColor} flex items-center justify-center flex-shrink-0`}
      >
        <div className="text-center">
          <div className="text-4xl font-bold">{scores.overall}</div>
          <div className="text-xs text-[var(--muted)] uppercase tracking-wide">/ 100</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-center md:text-left">
        <h2 className="text-2xl font-bold tracking-tight">{t('overallScore')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('overallSubtitle', { platform })}</p>
      </div>
    </Card>
  );
}

function ScoresGrid({ scores }: { scores: Scores }) {
  const t = useTranslations('Dashboard');
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('scoresSection')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ScoreTile label={t('scoreCatalog')} value={scores.catalogCompleteness} />
        <ScoreTile label={t('scoreCopy')} value={scores.copyQuality} />
        <ScoreTile label={t('scoreVisual')} value={scores.visualQuality} />
        <ScoreTile label={t('scoreTagging')} value={scores.taggingQuality} />
      </div>
    </section>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  const accent =
    value >= 75
      ? 'text-[var(--success)]'
      : value >= 50
        ? 'text-[var(--warning)]'
        : 'text-[var(--danger)]';
  return (
    <Card variant="secondary" className="p-4">
      <div className="text-xs uppercase text-[var(--muted)] tracking-wide">{label}</div>
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
        <Stat label={t('avgImages')} value={String(summary.averages?.imageCount ?? '—')} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="secondary" className="p-3">
      <div className="text-xs uppercase text-[var(--muted)] tracking-wide">{label}</div>
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

function StaticSkeleton() {
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

// ==========================================================================
// Optimizations tab — full project-wide jobs history
// ==========================================================================

type ProjectJobRow = typeof jobs.$inferSelect & {
  product: {
    id: string;
    sourceId: string | null;
    handle: string | null;
    title: string;
  } | null;
};

function ProjectJobsList({
  items,
  siteId
}: {
  items: ProjectJobRow[];
  siteId: string;
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
      <Card.Content className="p-0 divide-y divide-[var(--border)]">
        {items.map((j) => {
          const productHref = j.product?.id
            ? `/dashboard/sites/${siteId}/products/${j.product.id}`
            : null;
          return (
            <div
              key={j.id}
              className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[var(--foreground)]">
                  {t(jobKindLabel(j.kind as never))}
                </span>
                {j.product ? (
                  productHref ? (
                    <Link
                      href={productHref}
                      className="text-xs text-[var(--muted)] truncate hover:text-[var(--accent)] hover:underline"
                    >
                      {j.product.title}
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--muted)] truncate">
                      {j.product.title}
                    </span>
                  )
                ) : null}
              </div>
              <ProjectJobStatusBadge status={j.status as JobStatus} />
            </div>
          );
        })}
      </Card.Content>
    </Card>
  );
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
