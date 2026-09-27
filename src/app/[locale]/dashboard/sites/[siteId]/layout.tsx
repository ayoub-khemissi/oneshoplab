import { enforceEmbeddedScope } from '@/entities/user';

/** Every page of a site: inside the Shopify admin, only the shop's own site. */
export default async function SiteLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  await enforceEmbeddedScope((await params).siteId);
  return children;
}
