import type { Metadata } from 'next';

// Authenticated area: noindex everywhere under /dashboard. The router
// applies this to every nested page.tsx automatically.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
