'use client';

import { Card, Spinner } from '@heroui/react';
import {
  Check,
  Copy,
  ExternalLink,
  Home,
  Info,
  Link2,
  Trash2,
  X
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import {
  createShareLinkAction,
  revokeShareLinkAction,
  setShareLinkShowOnHomeAction
} from '@/lib/share/actions';

interface ShareLinkRow {
  id: string;
  label: string | null;
  showOnHome: boolean;
  createdAt: Date | string;
  productSourceIds: string[];
}

interface CandidateProduct {
  sourceId: string;
  title: string;
  hasTitle: boolean;
  hasDescription: boolean;
  hasTags: boolean;
  hasImages: boolean;
}

interface ShareLinksCardProps {
  siteId: string;
  /** Site URL origin (e.g. https://oneshoplab.com) used to build the
   *  full clipboard-copy URL — server-resolved so the client doesn't
   *  guess at runtime. */
  publicAppUrl: string;
  /** The site's bare domain (e.g. "shop.example.com") used as the
   *  default label so each new share link is identifiable in the list
   *  without forcing the admin to type it. They can edit before submit. */
  defaultLabel: string;
  initialLinks: ShareLinkRow[];
  candidates: CandidateProduct[];
}

/**
 * Admin-only dashboard card on /dashboard/sites/[siteId]. Lets the
 * admin generate one-off public URLs for prospect outreach: each link
 * shows a static audit + 2 chosen products with their AI rewrites, no
 * login required.
 *
 * Server gates the create / revoke actions behind ADMIN_EMAILS, so
 * even if a regular merchant guesses this component's existence and
 * forges a request the server rejects it.
 */
export function ShareLinksCard({
  siteId,
  publicAppUrl,
  defaultLabel,
  initialLinks,
  candidates
}: ShareLinksCardProps) {
  const t = useTranslations('Share');
  const [links, setLinks] = useState<ShareLinkRow[]>(initialLinks);
  const [modalOpen, setModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function urlFor(id: string): string {
    return `${publicAppUrl.replace(/\/$/, '')}/share/${id}`;
  }

  async function copyToClipboard(id: string) {
    try {
      await navigator.clipboard.writeText(urlFor(id));
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      /* clipboard not granted — the URL is also visible in the row */
    }
  }

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] inline-flex items-center gap-2">
            <Link2 className="size-3.5" aria-hidden /> {t('title')}
          </span>
          <p className="text-xs text-[var(--muted)] max-w-xl leading-relaxed">
            {t('hint')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={candidates.length < 2}
          className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          title={candidates.length < 2 ? t('preconditionNoCandidates') : undefined}
        >
          {t('createButton')}
        </button>
      </div>

      {/* Precondition prompt: a share link needs at least 2 products
          with completed AI generations to render a meaningful before/
          after page. If none, surface a clear next step inline (a
          tooltip alone is too easy to miss). */}
      {candidates.length < 2 ? (
        <div
          role="status"
          className="flex items-start gap-2 p-3 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-xs text-[var(--foreground)]"
        >
          <Info className="size-4 mt-0.5 text-[var(--accent)] shrink-0" aria-hidden />
          <span className="leading-relaxed">
            {t('preconditionNoCandidates', { count: candidates.length })}
          </span>
        </div>
      ) : null}

      {links.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-start gap-3 p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]"
            >
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {link.label ? (
                    <span className="text-sm font-medium">{link.label}</span>
                  ) : null}
                  {link.showOnHome ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-mono"
                      title={t('onHomeBadge')}
                    >
                      <Home className="size-3" aria-hidden /> {t('onHomeBadge')}
                    </span>
                  ) : null}
                </div>
                <a
                  href={urlFor(link.id)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs font-mono text-[var(--accent)] hover:underline truncate inline-flex items-center gap-1"
                >
                  {urlFor(link.id)}
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
                <span className="text-[10px] text-[var(--muted)]">
                  {t('createdOn', {
                    date: new Date(link.createdAt).toLocaleDateString()
                  })}
                  {' · '}
                  {t('productCount', { count: link.productSourceIds.length })}
                </span>
              </div>
              <ShowOnHomeToggle
                linkId={link.id}
                siteId={siteId}
                value={link.showOnHome}
                onChange={(next) =>
                  setLinks((prev) =>
                    prev.map((l) => (l.id === link.id ? { ...l, showOnHome: next } : l))
                  )
                }
              />
              <button
                type="button"
                onClick={() => copyToClipboard(link.id)}
                aria-label={t('copyAria')}
                title={t('copyAria')}
                className="size-8 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center"
              >
                {copiedId === link.id ? (
                  <Check className="size-4 text-[var(--success)]" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
              <RevokeButton linkId={link.id} siteId={siteId} onDone={() => {
                setLinks((prev) => prev.filter((l) => l.id !== link.id));
              }} />
            </li>
          ))}
        </ul>
      )}

      {modalOpen ? (
        <CreateModal
          siteId={siteId}
          defaultLabel={defaultLabel}
          candidates={candidates}
          onCancel={() => setModalOpen(false)}
          onCreated={(row) => {
            setLinks((prev) => [row, ...prev]);
            setModalOpen(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function ShowOnHomeToggle({
  linkId,
  siteId,
  value,
  onChange
}: {
  linkId: string;
  siteId: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const t = useTranslations('Share');
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !value;
    // Optimistic flip — server result reconciles via revalidate.
    onChange(next);
    const formData = new FormData();
    formData.set('linkId', linkId);
    formData.set('siteId', siteId);
    formData.set('showOnHome', next ? '1' : '0');
    startTransition(async () => {
      const res = await setShareLinkShowOnHomeAction(formData);
      if (!res.ok) onChange(value);
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-pressed={value}
      title={value ? t('hideFromHome') : t('showOnHomeAria')}
      className={`size-8 rounded-md inline-flex items-center justify-center transition-colors ${
        value
          ? 'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'
          : 'hover:bg-[var(--default)] text-[var(--muted)]'
      } disabled:opacity-50`}
    >
      <Home className="size-4" aria-hidden />
    </button>
  );
}

function RevokeButton({
  linkId,
  siteId,
  onDone
}: {
  linkId: string;
  siteId: string;
  onDone: () => void;
}) {
  const t = useTranslations('Share');
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function handleRevoke() {
    const formData = new FormData();
    formData.set('linkId', linkId);
    formData.set('siteId', siteId);
    startTransition(async () => {
      const res = await revokeShareLinkAction(formData);
      if (res.ok) onDone();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t('revokeAria')}
        title={t('revokeAria')}
        className="size-8 rounded-md hover:bg-[var(--default)] hover:text-[var(--danger)] inline-flex items-center justify-center"
      >
        <Trash2 className="size-4" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        className="text-xs font-medium px-2 py-1 rounded bg-[var(--danger)] text-[var(--danger-foreground)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t('revokingShort') : t('revokeConfirm')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        aria-label={t('cancel')}
        className="size-7 rounded-md hover:bg-[var(--default)] inline-flex items-center justify-center"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function CreateModal({
  siteId,
  defaultLabel,
  candidates,
  onCancel,
  onCreated
}: {
  siteId: string;
  defaultLabel: string;
  candidates: CandidateProduct[];
  onCancel: () => void;
  onCreated: (row: ShareLinkRow) => void;
}) {
  const t = useTranslations('Share');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Pre-fill with the site's domain so the admin's link list stays
  // identifiable at a glance. Editable: a date suffix or prospect
  // name is often more useful for outreach tracking.
  const [label, setLabel] = useState<string>(defaultLabel);
  const [showOnHome, setShowOnHome] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
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
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col"
      >
        <div className="p-5 border-b border-[var(--border)] flex flex-col gap-1">
          <h3 className="text-base font-semibold">{t('modalTitle')}</h3>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {t('modalBody')}
          </p>
        </div>

        <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {t('labelField')}
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={120}
              placeholder={t('labelPlaceholder')}
              className="w-full text-sm rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
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
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              {t('pickProductsHint')}
            </p>
            <div className="flex flex-col gap-1.5 mt-1">
              {candidates.length === 0 ? (
                <p className="text-sm text-[var(--muted)] italic">
                  {t('errorNeedTwoProducts')}
                </p>
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
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggle(c.sourceId)}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <div className="flex-1 min-w-0 flex flex-col">
                        <span className="text-sm font-medium truncate">
                          {c.title}
                        </span>
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
          {errorMsg ? (
            <p className="text-xs text-[var(--danger)]">{errorMsg}</p>
          ) : null}
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
