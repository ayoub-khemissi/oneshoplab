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
    const isDark = resolvedTheme === 'dark';
    const color = isDark ? DARK : LIGHT;

    // Inside the app from a store, the meta is not what paints the bar: the
    // shell owns it, and it is the only way to reach Android's navigation bar
    // at all. An installed PWA is stuck with the colour its manifest carried at
    // install time — that one really is a platform limit, not ours.
    void syncNativeBars(isDark);
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

/** Running inside the native shell, where the system bars are ours to set. */
function inNativeShell(): boolean {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

async function syncNativeBars(isDark: boolean): Promise<void> {
  if (!inNativeShell()) return;
  try {
    // Imported lazily: a browser must never download the shell's runtime.
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // `Style.Dark` means dark *content* on a light bar — the plugin names the
    // glyphs, not the surface, which is the opposite of what the word suggests.
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
    await StatusBar.setBackgroundColor({ color: isDark ? DARK : LIGHT });
  } catch {
    // An older shell without the plugin keeps whatever its theme declared.
  }
}
