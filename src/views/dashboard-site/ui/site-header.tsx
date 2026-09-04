import { ArrowLeft, ExternalLink, PenLine, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { RelaunchAuditButton } from '@/features/run-audit/client';
import { SiteFavicon } from '@/shared/ui';
import type { Tab } from '../model/types';
import { sanitizeUserFacingError } from '@/shared/lib';

export function SiteHeaderBar({
  domain,
  url,
  canAdd,
  projectId,
  auditsUsed,
  auditsLimit,
  nextSlotAtIso,
  isManual
}: {
  domain: string;
  url: string;
  canAdd: boolean;
  projectId: string;
  auditsUsed: number;
  auditsLimit: number;
  nextSlotAtIso: string | null;
  /** Project's source === 'manual': swap the external storefront link
   *  for a plain title + "From scratch" badge, and replace the
   *  Relaunch-audit CTA with "+ Add product" (manual sites have no
   *  remote catalog to re-scrape). */
  isManual: boolean;
}) {
  const t = useTranslations('Dashboard');
  return (
    <header className="flex items-center justify-between gap-2 md:gap-3 flex-wrap">
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
        <Link
          href="/dashboard"
          title={t('backToDashboard')}
          aria-label={t('backToDashboard')}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors shrink-0"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden md:inline">{t('backToDashboard')}</span>
        </Link>
        {isManual ? (
          <div
            title={domain}
            className="inline-flex items-center gap-1.5 md:gap-2 text-sm md:text-base font-semibold min-w-0"
          >
            <PenLine className="size-3.5 md:size-4 text-[var(--accent)] shrink-0" aria-hidden />
            <span className="truncate">{domain}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono font-semibold shrink-0">
              {t('siteHeaderManualBadge')}
            </span>
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={domain}
            className="inline-flex items-center gap-1 md:gap-2 text-sm md:text-base font-semibold hover:text-[var(--accent)] transition-colors min-w-0"
          >
            <SiteFavicon
              domain={domain}
              size={18}
              className="rounded-sm shrink-0 !size-3.5 md:!size-[18px]"
            />
            <span className="truncate">{domain}</span>
            <ExternalLink className="size-3 md:size-4 opacity-60 shrink-0" aria-hidden />
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
        {isManual ? (
          <Link
            href={`/dashboard/sites/${projectId}/products/new`}
            title={t('siteHeaderAddProduct')}
            aria-label={t('siteHeaderAddProduct')}
            className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 transition-opacity text-sm font-medium"
          >
            <Plus className="size-3.5" />
            <span className="hidden md:inline">{t('siteHeaderAddProduct')}</span>
          </Link>
        ) : (
          <RelaunchAuditButton
            projectId={projectId}
            auditsUsed={auditsUsed}
            auditsLimit={auditsLimit}
            nextSlotAtIso={nextSlotAtIso}
          />
        )}
        {canAdd ? (
          <Link
            href="/dashboard/sites/new"
            title={t('addSite')}
            aria-label={t('addSite')}
            className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors text-sm font-medium"
          >
            <Plus className="size-3.5" />
            <span className="hidden md:inline">{t('addSite')}</span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Map known internal error codes the worker / audit pipeline emits onto
 * localised, user-readable strings. Anything unrecognised falls through
 * to sanitizeUserFacingError (which strips vendor names and trims) so we
 * never expose raw codes like `process_interrupted` or `no_report` in
 * the UI.
 */
const KNOWN_ERROR_CODES: Record<string, string> = {
  process_interrupted: 'errorProcessInterrupted',
  no_report: 'errorNoReport',
  audit_not_found: 'errorAuditNotFound',
  no_products_fetched: 'errorNoProductsFetched',
  // The most common failure of all, and it used to reach the merchant as its
  // raw English sentence embedded in a translated frame ("Audit échoué : Could
  // not detect a supported e-commerce platform on this URL."). Both the code
  // and the legacy sentence map here, so rows written before this read right.
  platform_not_detected: 'errorPlatformNotDetected',
  'Could not detect a supported e-commerce platform on this URL.': 'errorPlatformNotDetected'
};

export function StatusLine({
  status,
  error,
  catalogArriving = false
}: {
  status: string;
  error: string | null;
  /** The store is handing us its catalog: whatever the last audit says, it
   *  predates what is arriving, and showing its failure reads as breakage. */
  catalogArriving?: boolean;
}) {
  const t = useTranslations('Report');
  if (catalogArriving) {
    return (
      <p className="text-sm text-[var(--muted)] flex items-center gap-2">
        <PulsingDot /> {t('catalogArriving')}
      </p>
    );
  }
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
  if (status === 'failed') {
    const trimmed = (error ?? '').trim();
    const friendly =
      trimmed in KNOWN_ERROR_CODES ? t(KNOWN_ERROR_CODES[trimmed]) : sanitizeUserFacingError(error);
    return (
      <p role="alert" className="text-sm text-[var(--danger)]">
        {t('failed', { error: friendly })}
      </p>
    );
  }
  return null;
}

/**
 * The products tab while the catalog is on its way. An empty list there reads
 * as "you have no products", which is both wrong and alarming — the merchant
 * has just connected a store full of them.
 */
export function CatalogArrivingNotice() {
  const t = useTranslations('Report');
  return (
    <p
      data-testid="catalog-arriving"
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)] flex items-center gap-2"
    >
      <PulsingDot /> {t('catalogArrivingHint')}
    </p>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75 animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]" />
    </span>
  );
}

export function TabsNav({ active, siteId }: { active: Tab; siteId: string }) {
  const t = useTranslations('Dashboard');
  const tIntegrations = useTranslations('Integrations');
  return (
    <nav className="border-b border-[var(--border)] flex gap-1 -mt-2 overflow-x-auto overflow-y-hidden">
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
      <TabLink
        href={`/dashboard/sites/${siteId}?tab=integrations`}
        active={active === 'integrations'}
        label={tIntegrations('tabLabel')}
      />
      <TabLink
        href={`/dashboard/sites/${siteId}?tab=settings`}
        active={active === 'settings'}
        label={t('tabSettings')}
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
    'px-4 py-3 text-sm font-medium border-b-2 flex grow shrink-0 items-center justify-center gap-2 whitespace-nowrap text-center transition-[padding,font-size,line-height] duration-200 group-data-[compact=true]/sticky:px-2.5 group-data-[compact=true]/sticky:py-1.5 group-data-[compact=true]/sticky:text-xs';
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
