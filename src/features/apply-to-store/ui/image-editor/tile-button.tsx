'use client';

import type { ReactNode } from 'react';

/** One action under a tile. Full width by design: these are decisions about
 *  that photo, stacked so each is a target a thumb can hit — a wrapped row of
 *  chips is unusable on a phone. Its own file so the tile and the alt-text
 *  generator can share it without importing each other. */
export function TileButton({
  onClick,
  testId,
  icon,
  children,
  danger = false,
  disabled = false,
  ariaLabel
}: {
  onClick: () => void;
  testId: string;
  icon: ReactNode;
  children?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex w-full items-center justify-center gap-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px] disabled:opacity-40 ${
        danger
          ? 'hover:border-[var(--danger)] hover:text-[var(--danger)]'
          : 'hover:border-[var(--accent)] hover:text-[var(--accent)]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
