'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Every explanation lives under the `FieldHelp` namespace, keyed by topic.
 * The nine `issue.*` topics MUST mirror `IssueCode`
 * (`src/entities/audit/model/types.ts`) — `shared` sits below `entities` in the
 * FSD order so the union cannot be derived from it; `tests/unit/field-help.test.ts`
 * asserts the two stay in sync, and that every topic below resolves in en + fr.
 */
export type InfoHintTopic =
  | 'title'
  | 'description'
  | 'tags'
  | 'images'
  | 'altText'
  | 'imageCount'
  | 'imageResolution'
  | 'score.overall'
  | 'score.catalogCompleteness'
  | 'score.copyQuality'
  | 'score.visualQuality'
  | 'score.taggingQuality'
  | 'credits'
  | 'pendingSync'
  | 'customInstructions'
  | 'chatModel'
  | 'imageQuality'
  | 'issue.no_image'
  | 'issue.single_image'
  | 'issue.no_description'
  | 'issue.short_description'
  | 'issue.unstructured_description'
  | 'issue.short_title'
  | 'issue.no_tags'
  | 'issue.missing_alt_text'
  | 'issue.low_resolution_image';

export interface InfoHintProps {
  topic: InfoHintTopic;
  /** Already-translated name of what the hint sits next to. Goes into the
   *  button's `aria-label` so a screen-reader user hears which of the many
   *  hints on the page they just reached. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Panel geometry, in px. The panel is portalled to <body> and positioned
 *  from the trigger's rect: several call sites live inside `overflow-hidden`
 *  cards (the product suggestions Card, the image-editor tiles) where an
 *  absolutely-positioned panel would simply be clipped. */
const MAX_WIDTH = 288;
const GAP = 8;
const EDGE = 8;
/** Flip above the trigger when less than this is left below it. Two short
 *  sentences at 288px never exceed it, so the panel is never measured — which
 *  keeps the open path a single synchronous layout read (no flash, no
 *  useLayoutEffect on a component that is also server-rendered). */
const ESTIMATED_HEIGHT = 140;

interface PanelPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

/**
 * Circled "i" that explains, in plain words, what a field or a score buys the
 * merchant. Interaction model:
 *   - hover / focus opens it (transient, closes on leave / blur);
 *   - click or tap pins it open — touch devices have no hover, and a merchant
 *     reading a long sentence should not lose it by nudging the mouse;
 *   - Escape closes and returns focus to the button; a pointer press outside
 *     closes it too.
 * The page never loses its scroll (no body lock, no focus trap): the panel
 * simply re-anchors itself while the page moves under it.
 */
export function InfoHint({ topic, label, size = 'sm', className }: InfoHintProps) {
  const t = useTranslations('FieldHelp');
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // No `mounted` guard around createPortal: `position` is only ever set from a
  // pointer/focus handler, so the portal cannot be reached during SSR or the
  // hydration pass.
  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const width = Math.min(MAX_WIDTH, Math.max(160, vw - EDGE * 2));
    const centered = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(Math.max(centered, EDGE), Math.max(EDGE, vw - width - EDGE));
    const roomBelow = vh - rect.bottom;
    const flipUp = roomBelow < ESTIMATED_HEIGHT && rect.top > roomBelow;
    setPosition(
      flipUp
        ? { left, width, bottom: vh - rect.top + GAP }
        : { left, width, top: rect.bottom + GAP }
    );
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      hide();
      buttonRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      hide();
    };
    // `capture` so the panel follows the trigger inside scrollable ancestors
    // too, and `passive` so the hint never slows the page's own scrolling.
    const onReflow = () => place();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onReflow, { capture: true, passive: true });
    window.addEventListener('resize', onReflow, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onReflow, { capture: true });
      window.removeEventListener('resize', onReflow);
    };
  }, [open, hide, place]);

  const iconSize = size === 'md' ? 'size-4' : 'size-3.5';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="info-hint"
        data-topic={topic}
        aria-label={label ? t('trigger', { topic: label }) : t('triggerGeneric')}
        aria-describedby={open ? panelId : undefined}
        onClick={() => {
          if (pinned) {
            hide();
            return;
          }
          setPinned(true);
          show();
        }}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex shrink-0 cursor-help items-center justify-center rounded-full align-middle text-[var(--muted)] transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className ?? ''}`}
      >
        <Info className={iconSize} aria-hidden />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              data-testid="info-hint-panel"
              data-topic={topic}
              style={{
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom
              }}
              className="pointer-events-none fixed z-[9998] rounded-md border border-[var(--border)] bg-[var(--overlay)] px-3 py-2 text-xs leading-relaxed font-normal tracking-normal normal-case text-[var(--overlay-foreground)] shadow-[var(--overlay-shadow)]"
            >
              {t(topic)}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
