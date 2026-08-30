import { DashboardProductPage, type DashboardProductSearchParams } from '@/views/dashboard-product';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; siteId: string }>;
  searchParams: Promise<DashboardProductSearchParams>;
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { id: productId, siteId } = await params;
  return (
    <DashboardProductPage siteId={siteId} productId={productId} searchParams={await searchParams} />
  );
}
