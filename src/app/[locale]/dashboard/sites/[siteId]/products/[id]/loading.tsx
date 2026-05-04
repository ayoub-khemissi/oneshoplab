import { Card, Skeleton } from '@heroui/react';

/**
 * Streaming loading UI for /dashboard/sites/<siteId>/products/<id>. Mirrors
 * the live product detail page (header + custom-instructions card + main
 * source/AI card + past generations) so the layout doesn't flash.
 */
export default function ProductDetailLoading() {
  return (
    <main className="flex-1 p-6 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <Skeleton className="h-4 w-44 rounded" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-4 w-24 rounded" />
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>

      <Card variant="secondary" className="p-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-3 w-2/3 rounded" />
      </Card>

      <Card variant="secondary" className="overflow-hidden">
        <div className="grid md:grid-cols-[260px_1fr]">
          <Skeleton className="aspect-[4/5] md:aspect-auto md:h-full" />
          <div className="p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Skeleton className="h-4 w-32 rounded" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-32 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 pb-5 border-b border-[var(--border)]">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-16 w-full rounded" />
                <Skeleton className="h-8 w-32 rounded-md self-end" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    </main>
  );
}
