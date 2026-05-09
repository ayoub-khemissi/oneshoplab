'use client';

import { useEffect, useRef, useState } from 'react';

interface ExpandableTextProps {
  /** Plain text or raw HTML, depending on `html`. */
  text: string;
  /** When true, render the value via dangerouslySetInnerHTML inside a
   *  `prose` container so the merchant's tag set (<p>, <ul>, <li>,
   *  <strong>, …) renders the same way as on the dashboard product
   *  page. AI descriptions land here. */
  html?: boolean;
  /** Lines visible while collapsed. Default 5. The full body is always
   *  rendered into the DOM so we can measure overflow once on mount. */
  lineClamp?: number;
  expandLabel: string;
  collapseLabel: string;
  /** Optional Tailwind classes injected on the inner content wrapper.
   *  Keeps the parent in control of typography sizing. */
  contentClassName?: string;
}

/**
 * Description block that clamps to N lines by default and exposes a
 * "Show more / Show less" toggle when the content overflows. The
 * toggle stays hidden when the body fits in the clamp window so we
 * don't show a redundant button on short descriptions.
 *
 * Overflow detection runs once on mount (and whenever `text` changes)
 * by comparing scrollHeight to clientHeight while the clamp is
 * active. After that the user-driven expand/collapse just toggles
 * the clamp class; we don't re-measure since the natural size is
 * already known.
 */
export function ExpandableText({
  text,
  html = false,
  lineClamp = 5,
  expandLabel,
  collapseLabel,
  contentClassName = ''
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || expanded) return;
    const el = ref.current;
    // 1px slop accounts for sub-pixel rounding on some browsers.
    setHasOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text, lineClamp, expanded]);

  // Build the clamp via inline style so any line count works without
  // a Tailwind safelist. Toggled off when expanded.
  const clampStyle: React.CSSProperties | undefined = expanded
    ? undefined
    : {
        display: '-webkit-box',
        WebkitLineClamp: lineClamp,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden'
      };

  const baseClass = html
    ? `prose text-xs max-w-none ${contentClassName}`.trim()
    : `text-xs leading-relaxed ${contentClassName}`.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={ref} style={clampStyle} className={baseClass}>
        {html ? (
          // Description HTML is produced by the optim flow with a
          // tightly-scoped tag set; no script payloads. Same render
          // path as the dashboard product page.
          // eslint-disable-next-line react/no-danger
          <div dangerouslySetInnerHTML={{ __html: text }} />
        ) : (
          text
        )}
      </div>
      {hasOverflow ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[10px] uppercase tracking-wider font-mono font-medium text-[var(--accent)] hover:underline"
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      ) : null}
    </div>
  );
}
