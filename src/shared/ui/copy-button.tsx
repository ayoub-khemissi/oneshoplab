'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

interface CopyButtonProps {
  /** Plain text or HTML to copy. */
  value: string;
  /**
   * If true, copies as `text/html` (rich) to the clipboard so paste into
   * Shopify / WooCommerce / Wix rich editors preserves formatting. Falls
   * back to plain text if the rich clipboard API isn't available.
   */
  asHtml?: boolean;
  label: string;
  copiedLabel: string;
  size?: 'sm' | 'md';
}

/**
 * Tiny clipboard button. For HTML copy we use ClipboardItem so that pasting
 * into a WYSIWYG editor preserves <p>, <ul>, <strong>, etc. — saving the
 * merchant from manual reformatting.
 */
export function CopyButton({
  value,
  asHtml = false,
  label,
  copiedLabel,
  size = 'sm'
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      if (asHtml && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const htmlBlob = new Blob([value], { type: 'text/html' });
        const plainBlob = new Blob([value], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': plainBlob
          })
        ]);
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* swallow */
      }
    }
  }

  const sizeClasses = size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2.5 py-1';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`${sizeClasses} inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors font-medium`}
      title={label}
    >
      {copied ? (
        <Check className="size-3.5 text-[var(--success)]" />
      ) : (
        <Copy className="size-3.5" />
      )}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
