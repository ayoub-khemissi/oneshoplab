'use client';

import { Check, ClipboardCopy, MessageSquareText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  /** Lead domain — shown in the modal header for context. */
  domain: string;
}

const LANG_LABELS: Record<ContactLang, string> = {
  fr: 'FR',
  en: 'EN',
  it: 'IT',
  es: 'ES'
};
const LANGS: ContactLang[] = ['fr', 'en', 'it', 'es'];

/**
 * Per-lead "Copie" trigger that opens a centered modal with ready-to-
 * paste contact-form copy in four languages + copy-to-clipboard. A
 * modal (not inline expansion) keeps the dense leads table from
 * ballooning when a row is opened.
 */
export function LeadOutreachCopy({
  copies,
  primaryLang,
  variantLabel,
  domain
}: LeadOutreachCopyProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/50 transition-colors"
      >
        <MessageSquareText className="size-3.5" aria-hidden />
        Copie
      </button>
      {open ? (
        <OutreachModal
          copies={copies}
          primaryLang={primaryLang}
          variantLabel={variantLabel}
          domain={domain}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function OutreachModal({
  copies,
  primaryLang,
  variantLabel,
  domain,
  onClose
}: LeadOutreachCopyProps & { onClose: () => void }) {
  const [lang, setLang] = useState<ContactLang>(primaryLang);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const copy = copies[lang];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-lg w-full max-h-[88vh] flex flex-col text-left"
      >
        {/* Header ---------------------------------------------------- */}
        <div className="p-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className="text-base font-semibold truncate">{domain}</h3>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
              {variantLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="shrink-0 inline-flex items-center justify-center size-7 rounded hover:bg-[var(--default)] text-[var(--muted)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Language tabs --------------------------------------------- */}
        <div className="px-4 pt-3">
          <div className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors ${
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
        </div>

        {/* Body ------------------------------------------------------ */}
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <CopyField label="Objet" value={copy.subject} singleLine />
          <CopyField label="Message" value={copy.body} />
        </div>
      </div>
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
      // Clipboard blocked (insecure context / permissions) — operator
      // can still select the text manually.
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
        <p className="text-sm bg-[var(--default)]/40 rounded px-3 py-2 break-words">{value}</p>
      ) : (
        <pre className="text-sm bg-[var(--default)]/40 rounded px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">
          {value}
        </pre>
      )}
    </div>
  );
}
