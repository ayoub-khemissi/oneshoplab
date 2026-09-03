'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

/**
 * Keeps the system bars on the theme the app is actually showing.
 *
 * The `theme-color` metas rendered on the server can only answer the *phone's*
 * colour scheme, but the app carries its own switch: a phone in light mode
 * showing our dark theme got a white status bar with white glyphs in it —
 * unreadable. Once the resolved theme is known, both metas are set to it, so
 * whichever one the browser matches carries the right colour.
 *
 * Kept in sync by hand with `THEME_COLOR_LIGHT` / `THEME_COLOR_DARK`
 * (src/app/manifest.ts) — a client component cannot import a manifest route.
 */
const LIGHT = '#fafdff';
const DARK = '#020409';

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const color = resolvedTheme === 'dark' ? DARK : LIGHT;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = color;
      document.head.appendChild(meta);
      return;
    }
    metas.forEach((meta) => {
      meta.content = color;
    });
  }, [resolvedTheme]);

  return null;
}
