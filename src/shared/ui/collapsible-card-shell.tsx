'use client';

import { Card } from '@heroui/react';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface CollapsibleCardShellProps {
  /** Server-rendered top-row content shown both expanded and
   *  collapsed (typically the clickable domain link). */
  header: ReactNode;
  /** Server-rendered body — products + CTA. Hidden when collapsed. */
  children: ReactNode;
  /** Default to true so a first-paint visitor sees the proof before
   *  they have to click anything. */
  defaultExpanded?: boolean;
  expandLabel: string;
  collapseLabel: string;
}

/**
 * Card wrapper that renders the home-strip showcase entries with a
 * collapsible body. Header (domain link) is always visible, plus a
 * small chevron+label toggle on the right of the same row. Body
 * (products + primary CTA) is hidden when collapsed.
 *
 * The Card itself is part of this client wrapper so the whole layout
 * lives in one place; server-rendered children are passed through and
 * keep their server-side data (i18n, audit summary, etc.).
 */
export function CollapsibleCardShell({
  header,
  children,
  defaultExpanded = true,
  expandLabel,
  collapseLabel
}: CollapsibleCardShellProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Card variant="secondary" className="p-5 md:p-6 flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded-md hover:bg-[var(--default)] transition-colors"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
          {expanded ? collapseLabel : expandLabel}
        </button>
      </div>
      {expanded ? <div className="flex flex-col gap-5">{children}</div> : null}
    </Card>
  );
}
