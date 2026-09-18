import { DashboardCsvPage } from '@/views/dashboard-csv';

export const dynamic = 'force-dynamic';

export default async function CsvPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <DashboardCsvPage siteId={siteId} />;
}
