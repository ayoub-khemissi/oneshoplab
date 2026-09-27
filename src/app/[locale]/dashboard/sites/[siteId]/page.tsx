import { enforceEmbeddedScope } from '@/entities/user';
import { DashboardSitePage, type DashboardSiteSearchParams } from '@/views/dashboard-site';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<DashboardSiteSearchParams>;
}

export default async function ReportPage({ params, searchParams }: PageProps) {
  const { siteId } = await params;
  // Inside the Shopify admin: the shop's own site only (before any data is read).
  await enforceEmbeddedScope(siteId);
  return <DashboardSitePage siteId={siteId} searchParams={await searchParams} />;
}
