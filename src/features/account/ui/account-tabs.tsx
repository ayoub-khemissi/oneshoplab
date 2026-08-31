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
 * active route by exact-prefix match against the current pathname.
 *
 * Mirrors the per-site dashboard <TabsNav> compaction: the
 * group-data-[compact=true]/sticky: utility chain reads the
 * `data-compact` attribute set by an enclosing <ScrollAwareSticky>
 * and tightens the per-tab padding + font on scroll.
 */
export function AccountTabs({ labels }: AccountTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account sections"
      // overflow-y:hidden suppresses the spurious vertical scrollbar
      // some browsers add when overflow-x:auto is set on a flex row
      // whose intrinsic content height oscillates during the
      // compact-mode transition.
      className="border-b border-[var(--border)] flex gap-1 overflow-x-auto overflow-y-hidden"
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        const base =
          'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex grow shrink-0 items-center justify-center gap-2 text-center transition-[padding,font-size,line-height] duration-200 group-data-[compact=true]/sticky:px-2.5 group-data-[compact=true]/sticky:py-1.5 group-data-[compact=true]/sticky:text-xs';
        const state = active
          ? 'border-[var(--accent)] text-[var(--foreground)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]';
        return (
          <Link key={t.key} href={t.href} className={`${base} ${state}`}>
            {labels[t.key]}
          </Link>
        );
      })}
    </nav>
  );
}
