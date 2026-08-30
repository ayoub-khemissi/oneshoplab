'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Wrap the app in next-themes' provider so the `dark` class is toggled on
 * <html> and CSS tokens flip automatically (we already have light/dark
 * variants in globals.css under `:root` and `.dark`).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
