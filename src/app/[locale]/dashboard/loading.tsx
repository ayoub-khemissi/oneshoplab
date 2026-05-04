import { Card, Skeleton } from '@heroui/react';

/**
 * Streaming loading UI for /dashboard. Shown by Next while the server
 * component fetches the user's projects, audits and jobs. Mirrors the live
 * layout (header pills + site selector + scores grid + products list) so
 * the swap to the real page feels instant rather than jarring.
 */
export default function DashboardLoading() {
  return (
    <main className="flex-1 p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-48 rounded" />
          <Skeleton className="h-4 w-64 rounded" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </header>

      <Card variant="secondary" className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-9 w-44 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24 rounded" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i} variant="secondary" className="p-4 flex flex-col gap-2">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-9 w-20 rounded" />
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32 rounded" />
        <div className="flex flex-col sm:flex-row gap-2">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 w-44 rounded-md" />
        </div>
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i} variant="secondary" className="p-4 flex items-center gap-4">
              <Skeleton className="h-6 w-16 rounded" />
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </Card>
          ))}
        </ul>
      </section>
    </main>
  );
}
