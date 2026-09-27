import { enforceEmbeddedScope } from '@/entities/user';
import { DashboardHomePage } from '@/views/dashboard-home';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Inside the Shopify admin there is no sites list: only the shop's own site.
  await enforceEmbeddedScope();
  return <DashboardHomePage />;
}
