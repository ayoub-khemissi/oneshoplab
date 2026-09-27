import { enforceEmbeddedScope } from '@/entities/user';
import { DashboardCsvPage } from '@/views/dashboard-csv';

export const dynamic = 'force-dynamic';

export default async function CsvPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  // Inside the Shopify admin: the shop's own site only (before any data is read).
  await enforceEmbeddedScope(siteId);
  return <DashboardCsvPage siteId={siteId} />;
}
