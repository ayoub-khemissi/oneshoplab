'use client';

import { Link, usePathname } from '@/i18n/navigation';

interface AccountTabsProps {
  labels: {
    profile: string;
    subscription: string;
    preferences: string;
    credits: string;
  };
}

const TABS: Array<{ key: keyof AccountTabsProps['labels']; href: string }> = [
  { key: 'profile', href: '/account/profile' },
  { key: 'subscription', href: '/account/subscription' },
  { key: 'preferences', href: '/account/preferences' },
  { key: 'credits', href: '/account/credits' }
];

/**
 * Sub-navigation across the four /account/* surfaces. Highlights the
 * active route by exact-prefix match against the current pathname,
 * stripping the locale segment so it works on every locale variant.
 */
export function AccountTabs({ labels }: AccountTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account sections"
      className="border-b border-[var(--border)] flex gap-1 overflow-x-auto"
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              active
                ? 'border-[var(--accent)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {labels[t.key]}
          </Link>
        );
      })}
    </nav>
  );
}
