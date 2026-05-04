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
 * Fetches every URL, packs them into a single zip on the client (via
 * `client-zip` — streaming, no compression of already-compressed JPG/PNG)
 * and triggers ONE download. Prefer this over multiple sequential
 * downloads which browsers throttle or block as "auto-downloads".
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
      const files: { name: string; input: Blob; lastModified: Date }[] = [];
      let done = 0;
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
          // Skip files that fail to fetch — keep going so the merchant gets
          // whatever DID succeed.
        }
        done += 1;
        setProgress({ done, total: urls.length });
      }

      if (files.length === 0) {
        // Nothing fetched (CORS or all-failed). Fall back to opening tabs.
        urls.forEach((u) => window.open(u, '_blank', 'noopener,noreferrer'));
        return;
      }

      const zipBlob = await downloadZip(files).blob();
      const objectUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${zipName ?? prefix}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setBusy(false);
      setProgress(null);
    }
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

  const sizeClasses =
    size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2.5 py-1';

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
