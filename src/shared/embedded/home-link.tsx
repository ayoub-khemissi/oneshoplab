'use client';

import { embeddedHomePath, WIX_TOKEN_PARAM, type EmbeddedHost } from './lib';

declare global {
  interface Window {
    /** Set by the Wix bridge script (wix-bridge.ts). */
    __oslWixToken?: string;
  }
}

/**
 * Back to the admin's embedded home. It has its own root layout, so Next
 * loads it as a new document: inside Shopify, App Bridge gives it a fresh ID
 * token; inside Wix, the session token has to travel in the URL.
 */
export function EmbeddedHomeLink({
  host,
  locale,
  className,
  children
}: {
  host: EmbeddedHost;
  locale: string;
  className?: string;
  children: React.ReactNode;
}) {
  const base = `${embeddedHomePath(host)}?locale=${locale}`;
  return (
    <a
      href={base}
      className={className}
      onClick={(event) => {
        if (host !== 'wix' || !window.__oslWixToken) return;
        event.preventDefault();
        window.location.assign(
          `${base}&${WIX_TOKEN_PARAM}=${encodeURIComponent(window.__oslWixToken)}`
        );
      }}
    >
      {children}
    </a>
  );
}
