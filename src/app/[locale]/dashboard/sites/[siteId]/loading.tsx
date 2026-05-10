import { Card, Skeleton } from '@heroui/react';

/**
 * Streaming loading UI for /dashboard/sites/<siteId>. Shown while we fetch the audit row,
 * project ownership and AI jobs. Once the page renders, its own internal
 * skeletons (AISkeleton / StaticSkeleton) take over for in-progress audits.
 */
export default function ReportLoading() {
  return (
    <main className="flex-1 p-4 md:p-10 max-w-5xl w-full mx-auto flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-10 w-72 rounded" />
        <Skeleton className="h-4 w-48 rounded" />
      </header>

      <div className="flex gap-2">
        <Skeleton className="h-10 w-32 rounded-md" />
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 max-w-2xl">
          <Skeleton className="h-7 w-72 rounded" />
          <Skeleton className="h-4 w-full max-w-md rounded" />
        </div>
        <div className="flex flex-col gap-6">
          {[0, 1, 2].map((i) => (
            <Card key={i} variant="secondary" className="overflow-hidden">
              <div className="grid md:grid-cols-[260px_1fr]">
                <Skeleton className="aspect-[4/5] md:aspect-auto md:h-full" />
                <div className="p-5 flex flex-col gap-4">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-5 w-3/4 rounded" />
                  <Skeleton className="h-16 w-full rounded" />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <Skeleton className="aspect-square rounded-md" />
                    <Skeleton className="aspect-square rounded-md" />
                    <Skeleton className="aspect-square rounded-md" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
