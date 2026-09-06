import type { Metadata } from 'next';
import { TourGate } from '@/features/guided-tour';

// Authenticated area: noindex everywhere under /dashboard. The router
// applies this to every nested page.tsx automatically.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Mounted on the layout, not the pages: the walkthrough crosses four of
          them, and remounting it on every navigation would lose the step. */}
      <TourGate />
    </>
  );
}
