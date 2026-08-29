'use client';

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import type { NotificationKind } from '@/lib/db/schema';

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  jobId: string | null;
  auditId: string | null;
  productId: string | null;
  projectId: string | null;
  payload: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string; // serialised over the wire
}

interface NotificationBellProps {
  ariaLabel: string;
  /** Strings rendered inside the dropdown — passed in so the bell stays
   *  pure-client and the parent server header owns the i18n boundary. */
  labels: {
    panelTitle: string;
    emptyState: string;
    markAllRead: string;
    /** Per-kind short label. Keys mirror NotificationKind values. */
    kinds: Record<NotificationKind, string>;
    /** Localised product-field names — render the chat notif as
     *  "Titre : Tee-Shirt Orange…" rather than "title …". */
    fieldLabels: { title: string; description: string; tags: string };
    relativeNow: string;
    relativeMinutes: string; // "il y a {n} min"
    relativeHours: string; // "il y a {n} h"
    relativeDays: string; // "il y a {n} j"
  };
  /** Optional: parent can render the bell as a compact mobile variant
   *  (inside burger menu). When true, drops the badge ring and matches
   *  burger row styling. */
  variant?: 'desktop' | 'mobile-row';
}

/**
 * Header bell + dropdown. Polls /api/notifications every 25s while
 * the tab is focused so the badge stays roughly fresh. Click marks
 * everything read (per the product spec — the merchant is presumed
 * to have acknowledged the surface by opening it).
 *
 * Variant 'mobile-row' renders as a tappable row instead of an icon
 * button so it fits inside the burger menu drawer.
 */
export function NotificationBell({
  ariaLabel,
  labels,
  variant = 'desktop'
}: NotificationBellProps) {
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initial fetch + 25s poll while the page is visible. document.hidden
  // pauses the poll on background tabs so we don't burn bandwidth on
  // a fleet of forgotten Chrome windows.
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/notifications', {
          headers: { accept: 'application/json' },
          cache: 'no-store'
        });
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as {
          rows?: NotificationRow[];
          unreadCount?: number;
        };
        setRows(body.rows ?? []);
        setUnread(body.unreadCount ?? 0);
      } catch {
        // Network blip — keep last known state; the next tick retries.
      }
    };
    void fetchOnce();
    const id = window.setInterval(() => {
      if (!document.hidden) void fetchOnce();
    }, 25_000);
    const onVisible = () => {
      if (!document.hidden) void fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Close on outside click — desktop variant only. Mobile variant
  // lives inside the burger drawer which handles its own dismissal.
  useEffect(() => {
    if (variant !== 'desktop' || !open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, variant]);

  const markAllRead = async () => {
    setLoading(true);
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
      // Optimistic: zero the badge immediately, then re-fetch in 200ms
      // so the panel reflects the server-truth isRead transitions.
      setUnread(0);
      setRows((prev) => prev.map((r) => ({ ...r, isRead: true })));
    } catch {
      // Stay optimistic — next 25s poll reconciles.
    } finally {
      setLoading(false);
    }
  };

  const onToggle = () => {
    const next = !open;
    setOpen(next);
    // Opening the panel acknowledges everything (per spec). Closing
    // re-opening should NOT re-fire mark-read.
    if (next && unread > 0) {
      void markAllRead();
    }
  };

  const badgeText = unread > 99 ? '99+' : String(unread);

  if (variant === 'mobile-row') {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full inline-flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-[var(--default)] text-sm text-[var(--foreground)]"
        aria-label={ariaLabel}
      >
        <span className="inline-flex items-center gap-2">
          <Bell className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          {labels.panelTitle}
        </span>
        {unread > 0 ? (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[var(--danger)] text-white text-[10px] font-bold font-mono tabular-nums">
            {badgeText}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        title={ariaLabel}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex items-center justify-center size-8 md:size-9 rounded-md hover:bg-[var(--default)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-white text-[9px] font-bold font-mono tabular-nums ring-2 ring-[var(--background)]"
            aria-hidden
          >
            {badgeText}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          // On mobile: pin to screen edges with small margins so the
          // panel never overflows on the left (the bell sits ~16px
          // from the right, so an absolute right-0 dropdown of 360px
          // would bleed past the left edge of an iPhone SE). On md+:
          // floating panel anchored to the bell's right edge.
          className="fixed inset-x-2 top-16 max-h-[calc(100vh-5rem)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg z-50 flex flex-col md:absolute md:inset-auto md:top-auto md:right-0 md:mt-2 md:w-[360px] md:max-w-[90vw] md:max-h-[420px]"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
            <span className="text-sm font-semibold">{labels.panelTitle}</span>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-[var(--muted)]" aria-hidden />
            ) : (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center size-6 rounded hover:bg-[var(--default)] text-[var(--muted)]"
                aria-label="close"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
              {labels.emptyState}
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
              {rows.map((row) => (
                <li key={row.id}>
                  <NotificationItem
                    row={row}
                    labels={labels}
                    onNavigate={() => {
                      setOpen(false);
                      router.refresh();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({
  row,
  labels,
  onNavigate
}: {
  row: NotificationRow;
  labels: NotificationBellProps['labels'];
  onNavigate: () => void;
}) {
  const tone = kindTone(row.kind);
  const icon = kindIcon(row.kind);
  const detail = kindDetail(row, labels);
  const href = kindHref(row);
  const time = formatRelative(row.createdAt, labels);

  const body = (
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--default)]/50 transition-colors">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex items-center justify-center size-7 rounded-full ${tone}`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug text-[var(--foreground)]">{detail.title}</p>
        {detail.sub ? (
          <p className="mt-0.5 text-xs text-[var(--muted)] truncate">{detail.sub}</p>
        ) : null}
        <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]/80">
          {time}
        </p>
      </div>
      {!row.isRead ? (
        <span
          aria-hidden
          className="mt-1.5 shrink-0 size-2 rounded-full bg-[var(--accent)]"
          title="Unread"
        />
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} onClick={onNavigate} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

function kindTone(kind: NotificationKind): string {
  if (kind.endsWith('_completed')) return 'bg-[var(--success)]/15 text-[var(--success)]';
  return 'bg-[var(--danger)]/15 text-[var(--danger)]';
}

function kindIcon(kind: NotificationKind) {
  if (kind === 'chat_completed') return <Sparkles className="size-3.5" aria-hidden />;
  if (kind === 'chat_failed') return <AlertTriangle className="size-3.5" aria-hidden />;
  if (kind === 'image_completed') return <ImageIcon className="size-3.5" aria-hidden />;
  if (kind === 'image_failed') return <AlertTriangle className="size-3.5" aria-hidden />;
  if (kind === 'audit_completed') return <CheckCircle2 className="size-3.5" aria-hidden />;
  if (kind === 'audit_failed') return <AlertTriangle className="size-3.5" aria-hidden />;
  if (kind === 'bulk_completed') return <Wand2 className="size-3.5" aria-hidden />;
  return <AlertTriangle className="size-3.5" aria-hidden />;
}

const SUB_MAX_LEN = 60;
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

function kindDetail(
  row: NotificationRow,
  labels: NotificationBellProps['labels']
): { title: string; sub: string | null } {
  const payload = row.payload ?? {};
  const title = labels.kinds[row.kind] ?? row.kind;
  let sub: string | null = null;

  // Chat: "Titre : Tee-Shirt Orange et Blanc…" — composes the field
  // label with the captured preview. Falls back to just the label
  // when the preview is missing (legacy rows, parse-failed result).
  if (row.kind === 'chat_completed' || row.kind === 'chat_failed') {
    const field = typeof payload.field === 'string' ? payload.field : null;
    const preview = typeof payload.preview === 'string' ? payload.preview : null;
    const fieldLabel =
      field === 'title'
        ? labels.fieldLabels.title
        : field === 'description'
          ? labels.fieldLabels.description
          : field === 'tags'
            ? labels.fieldLabels.tags
            : null;
    if (fieldLabel && preview) {
      sub = truncate(`${fieldLabel} : ${preview}`, SUB_MAX_LEN);
    } else if (fieldLabel) {
      sub = fieldLabel;
    } else if (preview) {
      sub = truncate(preview, SUB_MAX_LEN);
    }
    return { title, sub };
  }

  // Images: render the product title the gen was about.
  if (row.kind === 'image_completed' || row.kind === 'image_failed') {
    const productTitle = typeof payload.productTitle === 'string' ? payload.productTitle : null;
    if (productTitle) sub = truncate(productTitle, SUB_MAX_LEN);
    return { title, sub };
  }

  // Audit: domain + (for the success case) the overall score.
  if (row.kind === 'audit_completed' || row.kind === 'audit_failed') {
    const domain = typeof payload.domain === 'string' ? payload.domain : null;
    const score = typeof payload.score === 'number' ? payload.score : null;
    if (domain && score != null && row.kind === 'audit_completed') {
      sub = truncate(`${domain} · ${score}/100`, SUB_MAX_LEN);
    } else if (domain) {
      sub = truncate(domain, SUB_MAX_LEN);
    }
    return { title, sub };
  }

  // Bulk: progress ratio over the run.
  if (row.kind === 'bulk_completed' || row.kind === 'bulk_failed') {
    const generated = typeof payload.generated === 'number' ? payload.generated : null;
    const total = typeof payload.total === 'number' ? payload.total : null;
    if (generated != null && total != null) sub = `${generated}/${total}`;
    return { title, sub };
  }

  return { title, sub };
}

function kindHref(row: NotificationRow): string | null {
  if (row.productId && row.projectId) {
    return `/dashboard/sites/${row.projectId}/products/${row.productId}`;
  }
  if (row.projectId) return `/dashboard/sites/${row.projectId}`;
  if (row.auditId) return `/dashboard`;
  return null;
}

function formatRelative(iso: string, labels: NotificationBellProps['labels']): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (deltaSec < 60) return labels.relativeNow;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return labels.relativeMinutes.replace('{n}', String(min));
  const hr = Math.floor(min / 60);
  if (hr < 24) return labels.relativeHours.replace('{n}', String(hr));
  const d = Math.floor(hr / 24);
  return labels.relativeDays.replace('{n}', String(d));
}
