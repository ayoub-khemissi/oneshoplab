'use client';

import { X } from 'lucide-react';

export function CancelButton({ onCancel, label }: { onCancel: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
      aria-label={label}
      title={label}
    >
      <X className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}
