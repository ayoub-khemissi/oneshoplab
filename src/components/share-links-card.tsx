'use client';

import { Card } from '@heroui/react';
import { Check, Copy, ExternalLink, Home, Info, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatDate } from '@/lib/format-date';
import { CreateModal } from '@/components/share-links/create-modal';
import { HomeOrderInput, ShowOnHomeToggle } from '@/components/share-links/home-controls';
import { RevokeButton } from '@/components/share-links/revoke-button';
import type { CandidateProduct, ShareLinkRow } from '@/components/share-links/types';

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
          <p className="text-xs text-[var(--muted)] max-w-xl leading-relaxed">{t('hint')}</p>
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
              className="flex flex-col gap-3 md:flex-row md:items-start p-3 rounded-md bg-[var(--default)]/40 border border-[var(--border)]"
            >
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {link.label ? <span className="text-sm font-medium">{link.label}</span> : null}
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
                    date: formatDate(link.createdAt)
                  })}
                  {' · '}
                  {t('productCount', { count: link.productSourceIds.length })}
                </span>
              </div>
              {/* Action cluster — full row on mobile (justified to the
                  end so taps are reachable with the thumb), inline on
                  desktop. */}
              <div className="flex items-center gap-1.5 md:gap-1 justify-end shrink-0">
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
                {link.showOnHome ? (
                  <HomeOrderInput
                    linkId={link.id}
                    siteId={siteId}
                    value={link.homeOrder ?? null}
                    onChange={(next) =>
                      setLinks((prev) =>
                        prev.map((l) => (l.id === link.id ? { ...l, homeOrder: next } : l))
                      )
                    }
                  />
                ) : null}
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
                <RevokeButton
                  linkId={link.id}
                  siteId={siteId}
                  onDone={() => {
                    setLinks((prev) => prev.filter((l) => l.id !== link.id));
                  }}
                />
              </div>
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
