import { DashboardImportPage } from '@/views/dashboard-import';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <DashboardImportPage siteId={siteId} />;
}
