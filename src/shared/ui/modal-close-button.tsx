'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ModalCloseButtonProps {
  onClose: () => void;
  /** `overlay` = light icon over a dark backdrop (full-screen image viewer). */
  tone?: 'panel' | 'overlay';
  /** Overrides the generic "Close" for screen readers when the dialog has a
   *  more precise word for leaving it. */
  label?: string;
}

/**
 * The way out of a dialog — same button, same corner, every time.
 *
 * It is pinned to the panel instead of being laid out inside the header on
 * purpose. HeroUI's `.modal__header` and `.drawer__header` are `flex-col`,
 * and that plain CSS class wins over the `flex row` intent of a utility
 * className, so a cross written as a header child silently drops BELOW the
 * title — which is exactly what happened to the angle picker. Out of flow,
 * the question cannot come back.
 *
 * The panel must be `relative`, and the title row needs room on the right
 * (`pr-10`) so a long heading never runs under the cross.
 */
export function ModalCloseButton({ onClose, tone = 'panel', label }: ModalCloseButtonProps) {
  const t = useTranslations('Common');
  // The overlay sits on a full-screen backdrop next to a same-sized action,
  // so it takes that corner's spacing rather than the panel's.
  const skin =
    tone === 'overlay'
      ? 'top-4 right-4 size-11 rounded-full bg-black/10 text-white backdrop-blur-md hover:bg-black/30'
      : 'top-3 right-3 size-8 rounded-md text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)]';
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label ?? t('close')}
      data-testid="modal-close"
      className={`absolute z-10 inline-flex shrink-0 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${skin}`}
    >
      <X className={tone === 'overlay' ? 'size-5' : 'size-4'} aria-hidden />
    </button>
  );
}
