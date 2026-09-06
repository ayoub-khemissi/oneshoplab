'use client';

import { Spinner } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ModalCloseButton, useModalHistory } from '@/shared/ui';
import { createShareLinkAction } from '../api/actions';
import type { CandidateProduct, ShareLinkRow } from '@/entities/share-link';

interface CreateModalProps {
  siteId: string;
  defaultLabel: string;
  candidates: CandidateProduct[];
  onCancel: () => void;
  onCreated: (row: ShareLinkRow) => void;
}

export function CreateModal({
  siteId,
  defaultLabel,
  candidates,
  onCancel,
  onCreated
}: CreateModalProps) {
  const t = useTranslations('Share');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Pre-fill with the site's domain so the admin's link list stays
  // identifiable at a glance. Editable: a date suffix or prospect
  // name is often more useful for outreach tracking.
  const [label, setLabel] = useState<string>(defaultLabel);
  const [showOnHome, setShowOnHome] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  // Back closes the modal, not the page (see useModalHistory).
  useModalHistory(true, onCancel);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  function toggle(sourceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else if (next.size < 2) {
        next.add(sourceId);
      }
      // Beyond 2, no-op (the radio-style "max 2" is enforced at the
      // checkbox click level — the server also re-validates).
      return next;
    });
  }

  async function handleCreate() {
    setSubmitting(true);
    setErrorMsg(null);
    const formData = new FormData();
    formData.set('siteId', siteId);
    if (label.trim()) formData.set('label', label.trim());
    if (showOnHome) formData.set('showOnHome', '1');
    for (const id of selected) formData.append('productSourceIds', id);
    try {
      const res = await createShareLinkAction(formData);
      if (!res.ok) {
        setErrorMsg(t(errorKey(res.error)));
        return;
      }
      // Echo back enough state for the parent list to update without
      // a full re-fetch. createdAt is approximated from the client
      // clock — close enough for the dashboard list ordering.
      onCreated({
        id: res.jobId!,
        label: label.trim() || null,
        showOnHome,
        createdAt: new Date().toISOString(),
        productSourceIds: Array.from(selected)
      });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = selected.size === 2 && !submitting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col"
      >
        <ModalCloseButton onClose={onCancel} />
        <div className="p-5 pr-12 border-b border-[var(--border)] flex flex-col gap-1">
          <h3 className="text-base font-semibold">{t('modalTitle')}</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">{t('modalBody')}</p>
        </div>

        <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('labelField')}
            </span>
            <input
              id="share-link-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder={t('labelPlaceholder')}
              className="w-full text-sm rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              id="share-show-on-home"
              type="checkbox"
              checked={showOnHome}
              onChange={(e) => setShowOnHome(e.target.checked)}
              className="size-4 mt-0.5 accent-[var(--accent)] cursor-pointer"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('showOnHomeLabel')}</span>
              <span className="text-xs text-[var(--muted)] leading-relaxed">
                {t('showOnHomeHint')}
              </span>
            </div>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('pickProducts', { selected: selected.size })}
            </span>
            <p className="text-xs text-[var(--muted)] leading-relaxed">{t('pickProductsHint')}</p>
            <div className="flex flex-col gap-1.5 mt-1">
              {candidates.length === 0 ? (
                <p className="text-sm text-[var(--muted)] italic">{t('errorNeedTwoProducts')}</p>
              ) : (
                candidates.map((c) => {
                  const isSelected = selected.has(c.sourceId);
                  const disabled = !isSelected && selected.size >= 2;
                  return (
                    <label
                      key={c.sourceId}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                          : 'border-[var(--border)] hover:border-[var(--muted)]'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        id={`share-candidate-${c.sourceId}`}
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggle(c.sourceId)}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <div className="flex-1 min-w-0 flex flex-col">
                        <span className="text-sm font-medium truncate">{c.title}</span>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          {c.hasTitle ? <Chip label={t('chipTitle')} /> : null}
                          {c.hasDescription ? <Chip label={t('chipDescription')} /> : null}
                          {c.hasTags ? <Chip label={t('chipTags')} /> : null}
                          {c.hasImages ? <Chip label={t('chipImages')} /> : null}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          {errorMsg ? <p className="text-xs text-[var(--danger)]">{errorMsg}</p> : null}
        </div>

        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting ? <Spinner size="sm" /> : null}
            {t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--default)] text-[var(--muted)] font-mono">
      {label}
    </span>
  );
}

function errorKey(code: string | undefined): string {
  switch (code) {
    case 'unauthorized':
      return 'errorUnauthorized';
    case 'need_two_products':
      return 'errorNeedTwoProducts';
    case 'site_not_found':
      return 'errorSiteNotFound';
    default:
      return 'errorGeneric';
  }
}
