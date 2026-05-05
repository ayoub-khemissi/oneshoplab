import type { Metadata } from 'next';

// Authenticated account area: noindex everywhere under /account.
export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
