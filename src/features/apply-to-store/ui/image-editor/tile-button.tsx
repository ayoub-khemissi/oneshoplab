'use client';

import type { ReactNode } from 'react';

/** The one small action button under a tile. Its own file so the tile and the
 *  alt-text generator can share it without importing each other. */
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
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-1 text-[11px] disabled:opacity-40 ${
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
