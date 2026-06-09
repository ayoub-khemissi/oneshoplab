'use client';

import { Check, ClipboardCopy, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import type { ContactLang } from '@/lib/cold/contact-form';

export interface OutreachCopyData {
  subject: string;
  body: string;
}

interface LeadOutreachCopyProps {
  /** One copy per supported language. */
  copies: Record<ContactLang, OutreachCopyData>;
  /** The lead's detected language — drives which tab opens first. */
  primaryLang: ContactLang;
  /** Shown as a small caption so the operator knows which message they're
   *  about to paste (audit-led vs generic vs agency). */
  variantLabel: string;
}

const LANG_LABELS: Record<ContactLang, string> = {
  fr: 'FR',
  en: 'EN',
  it: 'IT',
  es: 'ES'
};
const LANGS: ContactLang[] = ['fr', 'en', 'it', 'es'];

/**
 * Per-lead collapsible that surfaces ready-to-paste contact-form copy
 * in three languages with copy-to-clipboard. Collapsed by default to
 * keep the leads table scannable; expands inline on click.
 */
export function LeadOutreachCopy({
  copies,
  primaryLang,
  variantLabel
}: LeadOutreachCopyProps) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<ContactLang>(primaryLang);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/50 transition-colors"
      >
        <MessageSquareText className="size-3.5" aria-hidden />
        Copie
      </button>
    );
  }

  const copy = copies[lang];

  return (
    <div className="flex flex-col gap-2 min-w-[280px] max-w-[420px]">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                l === lang
                  ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {LANG_LABELS[l]}
              {l === primaryLang ? (
                <span className="ml-0.5 opacity-60" title="langue du lead">
                  •
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          fermer
        </button>
      </div>

      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
        {variantLabel}
      </span>

      <CopyField label="Objet" value={copy.subject} singleLine />
      <CopyField label="Message" value={copy.body} />
    </div>
  );
}

function CopyField({
  label,
  value,
  singleLine = false
}: {
  label: string;
  value: string;
  singleLine?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permissions) — fall back
      // to selecting the text so the operator can Ctrl+C manually.
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
          {label}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          {copied ? (
            <>
              <Check className="size-3" aria-hidden /> copié
            </>
          ) : (
            <>
              <ClipboardCopy className="size-3" aria-hidden /> copier
            </>
          )}
        </button>
      </div>
      {singleLine ? (
        <p className="text-xs bg-[var(--default)]/40 rounded px-2 py-1.5 break-words">
          {value}
        </p>
      ) : (
        <pre className="text-xs bg-[var(--default)]/40 rounded px-2 py-1.5 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
          {value}
        </pre>
      )}
    </div>
  );
}
