import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_IMAGE_QUALITY,
  type ChatModelId,
  type ImageQualityId,
  resolveChatModelId
} from '@/entities/ai-model';
import { notFound, redirect } from 'next/navigation';
import { AutoRefresh, ScrollAwareSticky } from '@/shared/ui';
import { PaginatedProductsList } from './paginated-products-list';
import { SiteBulkPrefsEditor } from '@/features/bulk-generate/client';
import { SiteInstructionsEditor, SiteLanguageEditor } from '@/features/manage-project';
import { loadAuditQuota, type UserPlan } from '../api/audit-quota';
import { buildProductIdByKey, buildProductsView, loadOptimRows } from '../api/products-view';
import {
  ACTIVITY_PAGE_SIZE,
  PRODUCTS_SORT_KEYS,
  type ProductsSortKey,
  type ProjectJobRow,
  type Scores,
  type SummaryShape,
  type Tab
} from '../model/types';
import { BulkGenerateSection } from '@/widgets/bulk-generate-section';
import { ShareLinksCard } from '@/widgets/share-links-card';
import { isAdminEmail } from '@/entities/user';
import { listProductsWithGenerations, listShareLinksForSite } from '@/entities/share-link';
import { listProjectKeys } from '@/entities/api-key';
import { listPendingChangesForSite, PendingChangesList } from '@/features/apply-to-store';
import {
  INTEGRATION_PLATFORMS,
  isUsableKey,
  readWpPluginVersion,
  IntegrationsWizard,
  toSiteKeySummary,
  type IntegrationPlatform
} from '@/features/integrations';
import {
  getActiveBulkJob,
  getEffectiveBulkPrefs,
  getLatestBulkJobDetail,
  listBulkCandidates,
  listBulkCandidatesWithStatus,
  resolveBulkPrefs
} from '@/features/bulk-generate';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { audits, jobs, products, projects } from '@/shared/db/schema';
import { OverviewTab, StaticSkeleton } from './overview-tab';
import { ProjectJobsList } from './project-jobs-list';
import { SiteHeaderBar, StatusLine, TabsNav } from './site-header';

export interface DashboardSiteSearchParams {
  tab?: string;
  /** Server-rendered pagination for the activity tab — 15 jobs per
   *  page, sorted by createdAt desc. Falls back to page 1 if the
   *  value is missing or invalid. */
  activityPage?: string;
  /** Products tab: page number, search query, sort key, and the
   *  archived-visibility toggle — all server-controlled so the
   *  current view is shareable via URL and the merchant doesn't
   *  have to scroll-then-paginate after a navigation. */
  productsPage?: string;
  q?: string;
  sort?: string;
  showArchived?: string;
}

export async function DashboardSitePage({
  siteId,
  searchParams
}: {
  siteId: string;
  searchParams: DashboardSiteSearchParams;
}) {
  const {
    tab: rawTab,
    activityPage: rawActivityPage,
    productsPage: rawProductsPage,
    q: rawQuery,
    sort: rawSort,
    showArchived: rawShowArchived
  } = searchParams;
  const activeTab: Tab =
    rawTab === 'products'
      ? 'products'
      : rawTab === 'jobs'
        ? 'jobs'
        : rawTab === 'integrations'
          ? 'integrations'
          : rawTab === 'settings'
            ? 'settings'
            : 'overview';
  const activityPage = Math.max(1, Number.parseInt(rawActivityPage ?? '1', 10) || 1);
  const productsPage = Math.max(1, Number.parseInt(rawProductsPage ?? '1', 10) || 1);
  const productsQuery = (rawQuery ?? '').trim();
  const productsSort: ProductsSortKey = (PRODUCTS_SORT_KEYS as readonly string[]).includes(
    rawSort ?? ''
  )
    ? (rawSort as ProductsSortKey)
    : 'recently-optimized';
  const productsShowArchived = rawShowArchived === '1';

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
  //
  // `audit.summary` is a JSON blob that scales linearly with the
  // catalog size (≈1-2 MB on a 200-product store) — only the
  // overview and products tabs actually read from it. The Activity
  // and Settings tabs render fine off the small `status` + `scores`
  // fields, so we use a two-step lookup that omits `summary` for
  // those tabs and saves a multi-MB roundtrip per navigation.
  const { findLatestAuditForProject, findLatestAuditIdWhere } = await import('@/entities/audit');
  const needsSummary = activeTab === 'overview' || activeTab === 'products';
  // Loose type: the slim variant omits `summary` / `anonToken` etc.
  // but downstream code never reaches for those when needsSummary is
  // false (overview / products are the only consumers of summary).
  type AuditRow = Awaited<ReturnType<typeof findLatestAuditForProject>>;
  let audit: AuditRow;
  if (needsSummary) {
    audit = await findLatestAuditForProject(project.id, project.domain);
  } else {
    // Pick the latest id with the same OR fallback as the full helper,
    // then fetch only the cheap columns we actually consume below.
    const { or, and, isNull, eq: eqx } = await import('drizzle-orm');
    const id = await findLatestAuditIdWhere(
      or(
        eqx(audits.projectId, project.id),
        and(isNull(audits.projectId), eqx(audits.domain, project.domain ?? ''))
      )!
    );
    audit = id
      ? (((await db.query.audits.findFirst({
          where: eq(audits.id, id),
          columns: {
            id: true,
            url: true,
            domain: true,
            platform: true,
            status: true,
            scores: true,
            productsSampled: true,
            createdAt: true,
            startedAt: true,
            completedAt: true
          }
        })) ?? null) as AuditRow)
      : null;
  }
  if (!audit) notFound();

  const summary = ((audit as { summary?: unknown }).summary ?? {}) as SummaryShape;
  const decoded = project.domain ?? project.name;

  // Both writes are documented "fire-and-forget" — awaiting them
  // blocks the page render for a DB write the user doesn't see.
  const { touchProjectLastView } = await import('@/features/manage-project');
  const { refreshProjectIfStale } = await import('@/features/run-audit');
  void touchProjectLastView(project.id).catch((e) => console.error('[sites page last-view]', e));
  void refreshProjectIfStale(project.id).catch((e) =>
    console.error('[sites page auto-refresh]', e)
  );

  // Site quota — drives the conditional Add-site button. Back-to-dashboard
  // is always visible now that we navigate via the hub (no auto-redirect).
  // This list is reused below for the audit rate-limit window — keep ONE
  // copy so we don't fan out duplicate queries on every tab click.
  const { siteLimitForPlan } = await import('@/entities/ai-model');
  const userSites = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    columns: { id: true }
  });
  const userProjectIdsList = userSites.map((p) => p.id);
  const siteLimit = siteLimitForPlan(session.user.plan);
  const canAddSite = userSites.length < siteLimit;

  // Pull every product row so we can map the audit-summary's denormalized
  // snapshot (sourceId/handle) onto the actual `products.id` UUID — that's
  // what the URLs use now (avoids slug collisions and encoding pitfalls).
  // Plus the project's job history for the Activity tab.
  const [initialProductRows, projectJobs] = await Promise.all([
    db.query.products.findMany({
      where: eq(products.projectId, project.id),
      columns: {
        id: true,
        sourceId: true,
        handle: true,
        title: true,
        sourceUrl: true,
        status: true,
        productType: true
      }
    }),
    db.query.jobs.findMany({
      where: eq(jobs.projectId, project.id),
      orderBy: [desc(jobs.createdAt)],
      limit: ACTIVITY_PAGE_SIZE,
      offset: (activityPage - 1) * ACTIVITY_PAGE_SIZE,
      with: {
        product: {
          columns: { id: true, sourceId: true, handle: true, title: true, status: true }
        }
      }
    })
  ]);

  // Total job count + unfinished probe — both are cheap SQL aggregates
  // and live independently from the paginated `projectJobs` slice so
  // we don't lose the "any pending/running?" signal when the user is
  // on a later page.
  const [activityTotalRow, unfinishedCountRow] = await Promise.all([
    db.select({ value: count() }).from(jobs).where(eq(jobs.projectId, project.id)),
    db
      .select({ value: count() })
      .from(jobs)
      .where(and(eq(jobs.projectId, project.id), inArray(jobs.status, ['pending', 'running'])))
  ]);
  const activityTotal = activityTotalRow[0]?.value ?? 0;
  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));

  // Backfill: legacy audits never inserted into the products table (the
  // pipeline only wrote `audits.summary`). On first visit after the refactor,
  // hydrate the table from the summary so the per-product UUID URLs resolve.
  let productRows = initialProductRows;
  const summaryAll = summary.allProducts ?? [];
  if (productRows.length === 0 && summaryAll.length > 0 && audit.platform !== null) {
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
        handle: r.handle,
        title: r.title,
        sourceUrl: r.sourceUrl,
        status: 'active' as const,
        productType: null as string | null
      }));
    }
  }

  const productIdByKey = buildProductIdByKey(productRows);

  // This per-product aggregation is only consumed by the products
  // tab's list (badges + sort by last-optim). Skipping it on
  // overview/jobs/settings avoids a full table scan on `jobs` whose
  // size scales with how many generations the user has run.
  const optimRows = activeTab === 'products' ? await loadOptimRows(project.id) : [];

  // Same gating — only the products tab renders the paginated list
  // and the bulk-section's productTitleById map. Saves an O(n)
  // iteration over a 200+ entry array on every nav to overview /
  // jobs / settings on big catalogs.
  const {
    productsSlice,
    safeProductsPage,
    productsTotalPages,
    productsTotalActive,
    productsTotalArchived,
    productsFilteredTotal,
    productTitleById
  } = buildProductsView({
    activeTabIsProducts: activeTab === 'products',
    summaryAllProducts: summary.allProducts ?? [],
    productRows,
    optimRows,
    productIdByKey,
    productsShowArchived,
    productsQuery,
    productsSort,
    productsPage
  });

  // Driven by the dedicated count query above so pagination on the
  // activity tab doesn't hide a running job that just rolled off
  // page 1.
  const hasUnfinishedJobs = (unfinishedCountRow[0]?.value ?? 0) > 0;
  // An audit that says "completed" but pulled 0 products is a soft
  // failure — the scraper either hit a closed platform endpoint or
  // picked the wrong adapter. The audit row itself stays
  // status=completed (no exception was thrown), but for everything
  // user-visible — the StatusLine error band, the dashboard card
  // colour, the overview tab gating — we promote it to "failed" and
  // synthesise a friendly message via the `no_products_fetched`
  // code.
  const effectiveStatus =
    audit.status === 'completed' && (audit.productsSampled ?? 0) === 0
      ? ('failed' as const)
      : audit.status;
  const effectiveError =
    effectiveStatus === 'failed' && audit.status === 'completed'
      ? 'no_products_fetched'
      : audit.error;
  const auditLoading = effectiveStatus === 'pending' || effectiveStatus === 'running';
  const isLoading = auditLoading || hasUnfinishedJobs;

  const userPlan = (session.user.plan ?? 'free') as UserPlan;
  // Reuses `userProjectIdsList` computed above — see comment.
  const { auditsLimit, auditsUsed, nextSlotAtIso } = await loadAuditQuota(
    userPlan,
    userProjectIdsList
  );

  // Bulk catalog generation (Pro+ only) — five DB queries between
  // listBulkCandidates / listBulkCandidatesWithStatus / active /
  // detail. Skip them entirely when:
  //   - the plan can't bulk-generate (Free / Starter never see the CTA), or
  //   - the user is on a tab that doesn't render the bulk section
  //     (only `products` does).
  // Saves ~5 round-trips per tab click for the common case.
  const bulkChatModel: ChatModelId = resolveChatModelId(session.user.preferredChatModel);
  const bulkImageQuality: ImageQualityId =
    (session.user.preferredImageQuality as ImageQualityId | undefined) ?? DEFAULT_IMAGE_QUALITY;
  const needsBulk = activeTab === 'products' && (userPlan === 'pro' || userPlan === 'scale');
  const [bulkCandidatesAll, bulkCandidatesPending, bulkActive, bulkDetail] = needsBulk
    ? await Promise.all([
        listBulkCandidates(project.id),
        listBulkCandidatesWithStatus(project.id, bulkChatModel, bulkImageQuality),
        getActiveBulkJob(project.id),
        getLatestBulkJobDetail(project.id)
      ])
    : [[], [], null, null];
  const bulkCostEstimate = bulkCandidatesPending.reduce((sum, c) => sum + c.pendingCost, 0);
  // Effective bulk prefs (site → account → legacy) for the products
  // tab modal AND the settings-tab editor. Cheap single join; only
  // loaded for plans that can bulk + the tabs that surface it.
  const needsBulkPrefs =
    (userPlan === 'pro' || userPlan === 'scale') &&
    (activeTab === 'products' || activeTab === 'settings');
  const bulkEffective = needsBulkPrefs ? await getEffectiveBulkPrefs(project.id) : null;

  // Admin-only: pre-load share links + candidate products for the
  // sales-prospection card on Settings. Gated by tab too because
  // `listProductsWithGenerations` walks the audit summary and was
  // adding ~30s to every tab on big catalogs (5096 products → 20K+
  // individual DB calls). ADMIN_EMAILS env gates the broader admin
  // surface so a regular merchant pays no DB cost regardless.
  const isAdmin = isAdminEmail(session.user.email);
  const needsAdminShare = isAdmin && activeTab === 'settings';
  const [shareLinks, shareCandidates] = needsAdminShare
    ? await Promise.all([
        listShareLinksForSite(session.user.id, project.id),
        listProductsWithGenerations(project.id)
      ])
    : [[], []];

  // Integrations tab: site keys + the plugin's "to apply" queue. Two cheap
  // indexed reads, gated by tab like everything else above.
  const [siteKeys, pendingChanges] =
    activeTab === 'integrations'
      ? await Promise.all([
          listProjectKeys({ projectId: project.id, userId: session.user.id }),
          listPendingChangesForSite(project.id)
        ])
      : [[], []];
  const detectedPlatform: IntegrationPlatform | null = (
    INTEGRATION_PLATFORMS as readonly string[]
  ).includes(project.source)
    ? (project.source as IntegrationPlatform)
    : null;
  const lastPluginCall = siteKeys
    .map((k) => k.lastUsedAt?.getTime() ?? 0)
    .reduce((max, ts) => Math.max(max, ts), 0);

  return (
    <main className="flex-1 p-4 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      {isLoading ? <AutoRefresh /> : null}

      <ScrollAwareSticky topOffsetPx={68}>
        <SiteHeaderBar
          domain={decoded}
          url={audit.url}
          canAdd={canAddSite}
          projectId={project.id}
          auditsUsed={auditsUsed}
          auditsLimit={auditsLimit}
          nextSlotAtIso={nextSlotAtIso}
          isManual={project.source === 'manual'}
        />
        {/* StatusLine is scrape-flow specific (queued / running /
            failed). Manual projects skip it entirely — they never go
            through a fetch-products lifecycle. */}
        {project.source === 'manual' ? null : (
          <StatusLine status={effectiveStatus} error={effectiveError} />
        )}
        <TabsNav active={activeTab} siteId={siteId} />
      </ScrollAwareSticky>

      {activeTab === 'overview' ? (
        auditLoading ? (
          <StaticSkeleton />
        ) : effectiveStatus === 'completed' && audit.scores != null ? (
          <OverviewTab
            scores={audit.scores as Scores}
            summary={summary}
            platform={audit.platform}
            siteId={siteId}
            productIdByKey={productIdByKey}
          />
        ) : null
      ) : activeTab === 'products' ? (
        <div className="flex flex-col gap-4">
          <BulkGenerateSection
            siteId={siteId}
            plan={userPlan}
            productCount={bulkCandidatesAll.length}
            costEstimate={bulkCostEstimate}
            initialCandidates={bulkCandidatesPending}
            initialActive={bulkActive}
            initialDetail={bulkDetail}
            creditsBalance={session.user.creditsBalance ?? 0}
            productTitleById={productTitleById}
            initialPrefs={bulkEffective?.prefs ?? resolveBulkPrefs(null)}
            initialSiteOverride={bulkEffective?.siteOverride ?? false}
            initialChatModel={bulkChatModel}
            initialImageQuality={bulkImageQuality}
          />
          <PaginatedProductsList
            siteId={siteId}
            products={productsSlice}
            page={safeProductsPage}
            totalPages={productsTotalPages}
            totalActiveCount={productsTotalActive}
            totalArchivedCount={productsTotalArchived}
            filteredTotal={productsFilteredTotal}
            query={productsQuery}
            sort={productsSort}
            showArchived={productsShowArchived}
          />
        </div>
      ) : activeTab === 'jobs' ? (
        <ProjectJobsList
          items={projectJobs as ProjectJobRow[]}
          siteId={siteId}
          page={activityPage}
          totalPages={activityTotalPages}
        />
      ) : activeTab === 'integrations' ? (
        <div className="flex flex-col gap-4">
          <IntegrationsWizard
            projectId={project.id}
            domain={project.domain ?? project.url ?? null}
            pluginVersion={readWpPluginVersion()}
            detectedPlatform={detectedPlatform}
            initialKeys={siteKeys.map((k) => toSiteKeySummary(k))}
            initialStatus={{
              hasActiveKey: siteKeys.some((k) => isUsableKey(k)),
              lastUsedAtIso: lastPluginCall > 0 ? new Date(lastPluginCall).toISOString() : null,
              productCount: productRows.filter((p) => p.status === 'active').length
            }}
            interest={project.integrationInterest ?? {}}
          />
          <PendingChangesList siteId={siteId} initialItems={pendingChanges} />
        </div>
      ) : (
        // settings tab
        <div className="flex flex-col gap-4">
          <SiteLanguageEditor
            projectId={project.id}
            initialOverride={project.languageOverride ?? null}
            detectedLanguage={summary.detectedLanguage ?? null}
          />
          <SiteInstructionsEditor
            projectId={project.id}
            initialValue={project.customInstructions ?? ''}
          />
          <SiteBulkPrefsEditor
            siteId={project.id}
            canBulk={userPlan === 'pro' || userPlan === 'scale'}
            initialPrefs={bulkEffective?.prefs ?? resolveBulkPrefs(null)}
            initialSiteOverride={bulkEffective?.siteOverride ?? false}
          />
          {isAdmin ? (
            <ShareLinksCard
              siteId={siteId}
              publicAppUrl={process.env.APP_URL ?? 'http://localhost:3000'}
              defaultLabel={project.domain ?? decoded ?? ''}
              initialLinks={shareLinks}
              candidates={shareCandidates}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}
