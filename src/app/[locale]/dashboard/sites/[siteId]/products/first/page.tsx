import { redirect } from 'next/navigation';
import { auth } from '@/entities/user';
import { pickTourProductId } from '@/views/dashboard-product';

export const dynamic = 'force-dynamic';

/**
 * Resolver the guided tour links to for its product steps.
 *
 * A brand-new merchant has no catalogue, so the tour used to draw an
 * imitation of a product sheet over the page — which taught a layout that
 * does not exist. It now always lands on the real product page: the site's
 * first product when there is one, the built-in sample otherwise.
 */
export default async function FirstProductPage({
  params
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const productId = await pickTourProductId(session.user.id, siteId);
  if (!productId) redirect('/dashboard');

  redirect(`/dashboard/sites/${siteId}/products/${productId}`);
}
