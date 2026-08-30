'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Binary light ↔ dark theme toggle. Renders nothing until mounted to avoid
 * SSR/CSR icon mismatch (next-themes only resolves on the client).
 */
export function ThemeToggle({ ariaLabel }: { ariaLabel: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="size-9 rounded-md" aria-hidden />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="size-9 rounded-md inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--default)] transition-colors"
      aria-label={ariaLabel}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
