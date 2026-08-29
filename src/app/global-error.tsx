'use client';

// Last-resort error boundary — replaces the root layout (NextIntl
// provider included) so no `useTranslations` / `Link` from
// `@/i18n/navigation` are usable here. Keep the markup self-
// contained: own <html>/<body>, raw <a>, English-only copy.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error.tsx]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#0a0a0a',
          color: '#f5f5f5'
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '1rem'
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.7, margin: 0 }}>
            A critical error occurred. We&apos;ve been notified.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.7rem',
                opacity: 0.5,
                margin: 0,
                wordBreak: 'break-all'
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                background: '#f5f5f5',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer'
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error renders outside the app router/i18n providers; <Link> has no context here */}
            <a
              href="/"
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#f5f5f5',
                textDecoration: 'none',
                border: '1px solid #333',
                borderRadius: '0.375rem'
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
