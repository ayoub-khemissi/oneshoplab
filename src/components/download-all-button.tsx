'use client';

import { downloadZip } from 'client-zip';
import { Download } from 'lucide-react';
import { useState } from 'react';

interface DownloadAllButtonProps {
  /** Image URLs to download. */
  urls: string[];
  /** Filename prefix — actual files inside the zip become `${prefix}-1.png`, etc. */
  prefix?: string;
  /** Name of the resulting zip (without extension). Defaults to `prefix`. */
  zipName?: string;
  label: string;
  /** Sets the visual size: 'sm' for inline next to a heading, 'md' for primary actions. */
  size?: 'sm' | 'md';
}

/**
 * Packages a list of URLs into a single zip and triggers ONE download.
 *
 * Two execution paths:
 *   - Server-side (preferred when any URL is on a host that doesn't
 *     serve CORS to us, e.g. R2's `*.r2.dev` or the kie temp host).
 *     POSTs the URLs to /api/zip-images and the server streams a zip
 *     back. The browser does a single same-origin fetch on the
 *     resulting attachment — no CORS wall.
 *   - Client-side (when every URL is on the same origin or a CORS-
 *     friendly merchant CDN). Fetches each, builds the zip in
 *     `client-zip`, downloads. Slightly cheaper for the server.
 *
 * Without the server path, "Download all" silently failed for AI
 * images (R2 doesn't add Access-Control-Allow-Origin) and the
 * fallback `window.open(url)` only ever fired for the first URL
 * because the pop-up blocker stops there.
 */
export function DownloadAllButton({
  urls,
  prefix = 'image',
  zipName,
  label,
  size = 'sm'
}: DownloadAllButtonProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (urls.length === 0) return null;

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setProgress({ done: 0, total: urls.length });
    try {
      // R2 / kie temp URLs go through the server zipper — those hosts
      // don't serve CORS to oneshoplab.com. Same-origin URLs also go
      // server-side so the merchant gets a single consistent path.
      // Anything else (merchant Shopify CDN, etc.) we still try
      // client-side first since those normally CORS just fine and a
      // round-trip through our server costs us bandwidth twice.
      if (urls.every(isServerSideHost)) {
        await zipViaServer(urls, prefix, zipName ?? prefix);
        return;
      }
      await zipViaClient(urls, prefix, zipName ?? prefix, (done, total) =>
        setProgress({ done, total })
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const sizeClasses = size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2.5 py-1';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`${sizeClasses} inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors font-medium disabled:opacity-60 disabled:cursor-wait`}
      title={label}
    >
      <Download className="size-3.5" />
      <span>
        {busy && progress
          ? `${progress.done}/${progress.total}`
          : `${label} (${urls.length})`}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hosts we know don't serve CORS, so the client-side fetcher cannot
 *  reach them. The server-side zipper has the matching allow-list. */
function isServerSideHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.host.toLowerCase();
    return (
      host.endsWith('.r2.dev') ||
      host.endsWith('.tempfile.aiquickdraw.com') ||
      host === 'tempfile.aiquickdraw.com' ||
      // Same-origin URLs — the public app URL. The server zipper accepts
      // R2 too so we also send these through it, but the cheap check is
      // "is this our origin", handled by location at runtime.
      host === window.location.host
    );
  } catch {
    return false;
  }
}

async function zipViaServer(
  urls: string[],
  prefix: string,
  zipName: string
): Promise<void> {
  const res = await fetch('/api/zip-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls, prefix, zipName })
  });
  if (!res.ok) {
    // Last-ditch fallback: open whichever URLs we can in tabs. The
    // pop-up blocker still caps this at one, but it surfaces *some*
    // image rather than silently nothing. Real fix is fixing the
    // server endpoint or its allow-list.
    urls.forEach((u) => window.open(u, '_blank', 'noopener,noreferrer'));
    return;
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, `${zipName}.zip`);
}

async function zipViaClient(
  urls: string[],
  prefix: string,
  zipName: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const files: { name: string; input: Blob; lastModified: Date }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = guessExtension(blob.type, url);
      files.push({
        name: `${prefix}-${i + 1}.${ext}`,
        input: blob,
        lastModified: new Date()
      });
    } catch {
      // Skip files that fail to fetch — keep going so the merchant
      // gets whatever DID succeed.
    }
    onProgress(i + 1, urls.length);
  }

  if (files.length === 0) {
    urls.forEach((u) => window.open(u, '_blank', 'noopener,noreferrer'));
    return;
  }

  const zipBlob = await downloadZip(files).blob();
  triggerBlobDownload(zipBlob, `${zipName}.zip`);
}

function triggerBlobDownload(blob: Blob, name: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

function guessExtension(mime: string, url: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/avif') return 'avif';
  const m = url.match(/\.([a-z0-9]{3,4})(?:\?|#|$)/i);
  return m ? m[1].toLowerCase() : 'png';
}
