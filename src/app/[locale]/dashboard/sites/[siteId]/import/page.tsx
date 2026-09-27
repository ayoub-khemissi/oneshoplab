import { enforceEmbeddedScope } from '@/entities/user';
import { DashboardImportPage } from '@/views/dashboard-import';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  // Inside the Shopify admin: the shop's own site only (before any data is read).
  await enforceEmbeddedScope(siteId);
  return <DashboardImportPage siteId={siteId} />;
}
