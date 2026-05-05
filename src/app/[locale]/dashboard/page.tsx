import { Card } from '@heroui/react';
import { desc, eq, inArray } from 'drizzle-orm';
import { ArrowRight, Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { siteLimitForPlan } from '@/lib/ai/models';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { audits, projects, type AuditStatus } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface ScoresShape {
  overall: number;
}

interface SiteCardData {
  projectId: string;
  domain: string;
  name: string;
  overallScore: number | null;
  productsCount: number | null;
  lastUpdatedRelative: string | null;
  auditStatus: AuditStatus | null;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    orderBy: [desc(projects.lastViewedAt), desc(projects.createdAt)]
  });

  const t = await getTranslations('Dashboard');
  const locale = await getLocale();
  const relTimeFormat = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  // Pull the latest audit per project so we can render score + product count
  // on each site card. One query, then group in JS.
  const projectIds = userProjects.map((p) => p.id);
  const allAudits = projectIds.length
    ? await db.query.audits.findMany({
        where: inArray(audits.projectId, projectIds),
        orderBy: [desc(audits.createdAt)]
      })
    : [];
  const latestAuditByProject = new Map<string, (typeof allAudits)[number]>();
  for (const a of allAudits) {
    if (a.projectId && !latestAuditByProject.has(a.projectId)) {
      latestAuditByProject.set(a.projectId, a);
    }
  }

  const sites: SiteCardData[] = userProjects.map((p) => {
    const latest = latestAuditByProject.get(p.id);
    const scores = (latest?.scores ?? null) as ScoresShape | null;
    const lastUpdatedAt = latest?.completedAt ?? latest?.createdAt ?? null;
    return {
      projectId: p.id,
      domain: p.domain ?? p.name,
      name: p.name,
      overallScore: scores?.overall ?? null,
      productsCount: latest?.productsSampled ?? null,
      lastUpdatedRelative: lastUpdatedAt ? formatRelative(lastUpdatedAt, relTimeFormat) : null,
      auditStatus: (latest?.status ?? null) as AuditStatus | null
    };
  });

  const siteLimit = siteLimitForPlan(session.user.plan);
  const canAddSite = sites.length < siteLimit;

  return (
    <main className="flex-1 p-8 max-w-6xl w-full mx-auto flex flex-col gap-8">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-4xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm opacity-70">
            {t('welcome', {
              email: session.user.name ?? session.user.email ?? ''
            })}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <PillStat label={t('plan')} value={session.user.plan} />
          <PillStat label={t('credits')} value={String(session.user.creditsBalance)} highlight />
        </div>
      </header>

      {sites.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">{t('mySitesSection')}</h2>
            <span className="text-xs text-[var(--muted)] font-mono">
              {t('siteQuotaCounter', { used: sites.length, total: siteLimit })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sites.map((s) => (
              <SiteCard key={s.projectId} site={s} />
            ))}
            <AddSiteCard canAdd={canAddSite} />
          </div>
        </section>
      )}
    </main>
  );
}

function PillStat({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const colors = highlight
    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
    : 'bg-[var(--default)] text-[var(--foreground)]';
  return (
    <span className={`px-3 py-1.5 rounded-full ${colors} flex items-center gap-2`}>
      <span className="opacity-70 text-xs uppercase tracking-wide">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

function EmptyState() {
  const t = useTranslations('Dashboard');
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t('emptyTitle')}</Card.Title>
        <Card.Description>{t('emptySubtitle')}</Card.Description>
      </Card.Header>
      <Card.Footer>
        <Link
          href="/dashboard/sites/new"
          className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity font-medium text-sm inline-flex items-center gap-1.5"
        >
          <Sparkles className="size-4" />
          {t('ctaAudit')}
        </Link>
      </Card.Footer>
    </Card>
  );
}

function SiteCard({ site }: { site: SiteCardData }) {
  const t = useTranslations('Dashboard');
  const href = `/dashboard/sites/${site.projectId}`;
  return (
    <Link
      href={href}
      className="group rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors bg-[var(--card)] flex flex-col p-5 gap-4"
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)] font-mono">
            {site.name !== site.domain ? site.name : ' '}
          </span>
          <h3 className="font-semibold truncate">{site.domain}</h3>
        </div>
        {site.overallScore != null ? (
          <ScoreBadge score={site.overallScore} />
        ) : (
          <span className="text-xs px-2 py-0.5 rounded font-mono text-[var(--muted)] border border-[var(--border)]">
            —
          </span>
        )}
      </div>

      <SiteCardStatus
        status={site.auditStatus}
        productsCount={site.productsCount}
        lastUpdatedRelative={site.lastUpdatedRelative}
        labels={{
          products: (count: number) => t('siteCardProducts', { count }),
          updated: (when: string) => t('siteCardLastUpdated', { when }),
          running: t('siteCardAuditRunning'),
          failed: t('siteCardAuditFailed'),
          never: t('siteCardNeverAudited')
        }}
      />

      <div className="flex items-center justify-end gap-1.5 text-sm text-[var(--accent)] font-medium mt-auto pt-2 border-t border-[var(--border)] group-hover:gap-2 transition-all">
        {t('siteCardOpen')}
        <ArrowRight className="size-3.5" />
      </div>
    </Link>
  );
}

function SiteCardStatus({
  status,
  productsCount,
  lastUpdatedRelative,
  labels
}: {
  status: AuditStatus | null;
  productsCount: number | null;
  lastUpdatedRelative: string | null;
  labels: {
    products: (n: number) => string;
    updated: (when: string) => string;
    running: string;
    failed: string;
    never: string;
  };
}) {
  if (status === 'pending' || status === 'running') {
    return (
      <p className="text-xs text-[var(--muted)] flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]" />
        </span>
        {labels.running}
      </p>
    );
  }
  if (status === 'failed') {
    return <p className="text-xs text-[var(--danger)]">{labels.failed}</p>;
  }
  if (status == null || productsCount == null || lastUpdatedRelative == null) {
    return <p className="text-xs text-[var(--muted)] italic">{labels.never}</p>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
      <span>{labels.products(productsCount)}</span>
      <span>{labels.updated(lastUpdatedRelative)}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${tone}`}>
      {score}/100
    </span>
  );
}

function AddSiteCard({ canAdd }: { canAdd: boolean }) {
  const t = useTranslations('Dashboard');
  const href = canAdd ? '/dashboard/sites/new' : '/pricing';
  return (
    <Link
      href={href}
      title={canAdd ? undefined : t('siteLimitReached')}
      className="rounded-lg border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors flex flex-col items-center justify-center text-center gap-2 p-5 min-h-[180px] text-[var(--muted)]"
    >
      <Plus className="size-6" />
      <span className="font-medium text-sm">{t('addSiteCardTitle')}</span>
      <span className="text-xs opacity-70 max-w-[18rem]">{t('addSiteCardSubtitle')}</span>
    </Link>
  );
}

/**
 * Format a date as a coarse relative time, localized via Intl.RelativeTimeFormat
 * with `numeric: 'auto'` so common cases collapse to "yesterday" / "hier" rather
 * than "1 day ago" / "il y a 1 jour". Computed server-side at request time, so
 * refreshing the page bumps the value.
 */
function formatRelative(date: Date, fmt: Intl.RelativeTimeFormat): string {
  const diffMs = date.getTime() - Date.now();
  const min = Math.round(diffMs / 60_000);
  if (Math.abs(min) < 60) return fmt.format(min, 'minute');
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return fmt.format(hr, 'hour');
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 30) return fmt.format(day, 'day');
  const month = Math.round(day / 30);
  if (Math.abs(month) < 12) return fmt.format(month, 'month');
  return fmt.format(Math.round(month / 12), 'year');
}
