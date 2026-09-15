import { DashboardExportPage, type DashboardExportSearchParams } from '@/views/dashboard-export';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<DashboardExportSearchParams>;
}

export default async function ExportPage({ params, searchParams }: PageProps) {
  const { siteId } = await params;
  return <DashboardExportPage siteId={siteId} searchParams={await searchParams} />;
}
