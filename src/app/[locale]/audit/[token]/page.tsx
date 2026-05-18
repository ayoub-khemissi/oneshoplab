import { Card } from '@heroui/react';
import { and, eq, isNull } from 'drizzle-orm';
import { AlertTriangle, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { Link } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { audits } from '@/lib/db/schema';

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

export default async function FreeAuditResultPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const audit = await loadAnonAudit(token);
  if (!audit) notFound();

  const t = await getTranslations('FreeAudit');
  const tShare = await getTranslations('Share');
  const domain = audit.domain ?? '';

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

  return (
    <main className="flex-1 px-4 md:px-10 py-6 md:py-10 max-w-3xl w-full mx-auto flex flex-col gap-8">
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
        <Card variant="secondary" className="p-6 flex flex-col gap-5">
          <div className="flex flex-col items-center gap-2">
            <span className="eyebrow">{tShare('overallScore')}</span>
            <span className="text-6xl font-bold tabular-nums">
              {scores.overall}
              <span className="text-2xl text-[var(--muted)] font-normal">/100</span>
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ScoreBox label={tShare('axisCatalog')} value={scores.catalogCompleteness} />
            <ScoreBox label={tShare('axisCopy')} value={scores.copyQuality} />
            <ScoreBox label={tShare('axisVisual')} value={scores.visualQuality} />
            <ScoreBox label={tShare('axisTagging')} value={scores.taggingQuality} />
          </div>
        </Card>
      ) : (
        <Card variant="secondary" className="p-6 text-center text-sm text-[var(--muted)]">
          {t('noScores')}
        </Card>
      )}

      {/* Sign-up gate: the score is free, the AI before/after is not. */}
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
