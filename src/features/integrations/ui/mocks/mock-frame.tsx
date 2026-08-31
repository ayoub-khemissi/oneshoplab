import type { ReactNode } from 'react';

/**
 * Browser-window chrome around an illustrative admin view. Static and
 * hook-free so every mock stays server-safe; the whole frame is one image
 * for assistive tech (`role="img"`), the callouts stay readable text.
 */
export function MockFrame({
  id,
  url,
  label,
  children
}: {
  /** Stable id for tests (`[data-mock]`). */
  id: string;
  /** Fake address-bar content (the real admin URL the merchant will see). */
  url: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      data-mock={id}
      // `zoom` scales the whole mock uniformly on wider screens (text, chrome,
      // spacing) so the "screenshot" genuinely fills its half of the row; the
      // frame simply gets taller. Percent widths keep fitting under zoom.
      className="w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)] text-[10px] leading-tight select-none md:[zoom:1.15] xl:[zoom:1.3]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--default)]/60 px-2 py-1.5">
        <span className="flex gap-1" aria-hidden>
          <i className="size-2 rounded-full bg-[var(--border)]" />
          <i className="size-2 rounded-full bg-[var(--border)]" />
          <i className="size-2 rounded-full bg-[var(--border)]" />
        </span>
        <span className="flex-1 truncate rounded bg-[var(--background)] px-2 py-0.5 font-mono text-[9px] text-[var(--muted)]">
          {url}
        </span>
      </div>
      <div className="relative h-[190px] overflow-hidden">{children}</div>
    </div>
  );
}

/** Numbered marker placed next to the element the merchant has to click or copy. */
export function Callout({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-[var(--accent-foreground)] shadow ${className}`}
    >
      {n}
    </span>
  );
}

/** Ring drawn around the highlighted element. */
export const HIGHLIGHT =
  'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--background)]';

/** Left-hand admin menu shared by the WordPress and Shopify mocks. */
export function MockSidebar({
  items,
  active,
  highlight,
  callout,
  tone = 'dark'
}: {
  items: string[];
  active?: string;
  highlight?: string;
  callout?: number;
  tone?: 'dark' | 'light';
}) {
  const base =
    tone === 'dark'
      ? 'bg-[#1d2327] text-[#c3c4c7]'
      : 'bg-[var(--default)]/50 text-[var(--foreground)] border-r border-[var(--border)]';
  return (
    <ul className={`flex h-full w-[72px] shrink-0 flex-col gap-0.5 py-1.5 ${base}`}>
      {items.map((item) => {
        const isActive = item === active;
        const isHighlight = item === highlight;
        return (
          <li
            key={item}
            className={`relative mx-1 flex items-center justify-between rounded px-1.5 py-1 ${
              isActive ? (tone === 'dark' ? 'bg-[#2271b1] text-white' : 'bg-[var(--default)]') : ''
            } ${isHighlight ? HIGHLIGHT : ''}`}
          >
            <span className="truncate">{item}</span>
            {isHighlight && callout ? <Callout n={callout} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A button-looking box, optionally highlighted with a numbered callout. */
export function MockButton({
  children,
  primary,
  highlight,
  callout
}: {
  children: ReactNode;
  primary?: boolean;
  highlight?: boolean;
  callout?: number;
}) {
  return (
    <span
      className={`relative inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${
        primary
          ? 'bg-[#2271b1] text-white'
          : 'border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]'
      } ${highlight ? HIGHLIGHT : ''}`}
    >
      {children}
      {highlight && callout ? <Callout n={callout} className="-mr-1" /> : null}
    </span>
  );
}

/** A form field (label + fake input) with optional highlight. */
export function MockField({
  label,
  value,
  highlight,
  callout,
  mono
}: {
  label: string;
  value: string;
  highlight?: boolean;
  callout?: number;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-[var(--muted)]">{label}</span>
      <span
        className={`flex items-center justify-between rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 ${
          mono ? 'font-mono' : ''
        } ${highlight ? HIGHLIGHT : ''}`}
      >
        <span className="truncate">{value}</span>
        {highlight && callout ? <Callout n={callout} /> : null}
      </span>
    </label>
  );
}
