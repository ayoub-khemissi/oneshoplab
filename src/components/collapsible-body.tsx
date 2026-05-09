'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface CollapsibleBodyProps {
  /** Whether the panel is open on first paint. Server-rendered cards
   *  default to true so prospects see the proof immediately; the
   *  toggle then lets them fold cards once they've scanned them. */
  defaultExpanded?: boolean;
  expandLabel: string;
  collapseLabel: string;
  children: ReactNode;
}

/**
 * Pure-CSS-friendly collapsible wrapper for the home-strip showcase
 * cards. Server passes server-rendered children in; this component
 * just owns the expand/collapse state plus a chevron button. Lives
 * inline (full width) above the children so it visually anchors as
 * a card-section toggle.
 */
export function CollapsibleBody({
  defaultExpanded = true,
  expandLabel,
  collapseLabel,
  children
}: CollapsibleBodyProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
        {expanded ? collapseLabel : expandLabel}
      </button>
      {expanded ? <div className="flex flex-col gap-5">{children}</div> : null}
    </div>
  );
}
