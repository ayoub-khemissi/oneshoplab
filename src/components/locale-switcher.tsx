'use client';

import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  LOCALE_FLAGS,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type Locale
} from '@/i18n/routing';

interface LocaleSwitcherProps {
  current: Locale;
  ariaLabel: string;
}

/**
 * Header locale switcher: a flag-only button that opens a dropdown of every
 * supported locale. Each row shows a flag emoji and the locale's native name.
 * Uses next-intl's `usePathname` + `useRouter` to keep the current path when
 * switching locale.
 */
export function LocaleSwitcher({ current, ariaLabel }: LocaleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function pickLocale(locale: Locale) {
    setOpen(false);
    if (locale === current) return;
    router.replace(pathname, { locale });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-9 rounded-md inline-flex items-center justify-center text-lg leading-none hover:bg-[var(--default)] transition-colors"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${LOCALE_FLAGS[current]} ${LOCALE_LABELS[current]}`}
      >
        <span className="text-base">{LOCALE_FLAGS[current]}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[200px] max-h-[70vh] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg z-30 py-1"
        >
          {SUPPORTED_LOCALES.map((loc) => {
            const active = loc === current;
            return (
              <button
                key={loc}
                type="button"
                role="menuitem"
                onClick={() => pickLocale(loc)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 transition-colors ${
                  active
                    ? 'text-[var(--accent)] font-medium'
                    : 'text-[var(--foreground)] hover:bg-[var(--default)]'
                }`}
                aria-current={active ? 'true' : undefined}
              >
                <span className="inline-flex items-center gap-3">
                  <span className="text-base leading-none">{LOCALE_FLAGS[loc]}</span>
                  <span>{LOCALE_LABELS[loc]}</span>
                </span>
                {active ? <Check className="size-3.5" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
