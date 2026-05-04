'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type View = 'source' | 'ai';

interface GroupState {
  view: View;
  setView: (v: View) => void;
  syncCount: number;
}

const FieldSwapGroupContext = createContext<GroupState | null>(null);

export function FieldSwapGroup({
  children,
  defaultView = 'ai'
}: {
  children: React.ReactNode;
  defaultView?: View;
}) {
  const [view, setViewState] = useState<View>(defaultView);
  const [syncCount, setSyncCount] = useState(0);
  const setView = (v: View) => {
    setViewState(v);
    setSyncCount((n) => n + 1);
  };
  return (
    <FieldSwapGroupContext.Provider value={{ view, setView, syncCount }}>
      {children}
    </FieldSwapGroupContext.Provider>
  );
}

const baseBtn =
  'text-[10px] uppercase tracking-wider px-2 py-1 rounded transition-colors font-medium';
const activeBtn = 'bg-[var(--accent)] text-[var(--accent-foreground)]';
const idleBtn = 'text-[var(--muted)] hover:text-[var(--foreground)]';

interface ToggleProps {
  view: View;
  setView: (v: View) => void;
  sourceLabel: string;
  aiLabel: string;
  className?: string;
}

function Toggle({ view, setView, sourceLabel, aiLabel, className }: ToggleProps) {
  return (
    <div
      className={`flex items-center gap-0.5 rounded-md bg-[var(--default)] p-0.5 self-start ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => setView('source')}
        className={`${baseBtn} ${view === 'source' ? activeBtn : idleBtn}`}
        aria-pressed={view === 'source'}
      >
        {sourceLabel}
      </button>
      <button
        type="button"
        onClick={() => setView('ai')}
        className={`${baseBtn} ${view === 'ai' ? activeBtn : idleBtn}`}
        aria-pressed={view === 'ai'}
      >
        {aiLabel}
      </button>
    </div>
  );
}

/**
 * Hides children when the surrounding FieldSwapGroup is on the "source" view.
 * Use for AI-only content that has no source counterpart (e.g. Instagram post,
 * AI rationale) so the comparison stays clean.
 *
 * Outside a group, always renders children.
 */
export function HideOnSource({ children }: { children: React.ReactNode }) {
  const ctx = useContext(FieldSwapGroupContext);
  if (ctx?.view === 'source') return null;
  return <>{children}</>;
}

export function FieldSwapGroupToggle({
  sourceLabel,
  aiLabel,
  className
}: {
  sourceLabel: string;
  aiLabel: string;
  className?: string;
}) {
  const ctx = useContext(FieldSwapGroupContext);
  if (!ctx) return null;
  return (
    <Toggle
      view={ctx.view}
      setView={ctx.setView}
      sourceLabel={sourceLabel}
      aiLabel={aiLabel}
      className={className}
    />
  );
}

interface FieldSwapProps {
  source: React.ReactNode;
  ai: React.ReactNode;
  sourceLabel: string;
  aiLabel: string;
  /**
   * Section heading shown on the same row as the toggle. Pass an object to
   * display a different heading for each view (e.g. "Title" on source vs
   * "New SEO title" on AI). A string applies to both views.
   */
  label?: string | { source: string; ai: string };
  /**
   * Action(s) rendered just to the LEFT of the Source/AI toggle pill. Only
   * shown when on AI view (e.g. Copy buttons, Download all) since those
   * actions operate on the AI output. Toggles stay right-aligned.
   */
  aiAction?: React.ReactNode;
  /**
   * Same idea as `aiAction` but only shown when on the Source view (e.g.
   * Download all for the product's existing images).
   */
  sourceAction?: React.ReactNode;
}

export function FieldSwap({
  source,
  ai,
  sourceLabel,
  aiLabel,
  label,
  aiAction,
  sourceAction
}: FieldSwapProps) {
  const ctx = useContext(FieldSwapGroupContext);
  const [view, setView] = useState<View>(ctx?.view ?? 'ai');

  const groupSyncCount = ctx?.syncCount ?? 0;
  const groupView = ctx?.view ?? 'ai';
  useEffect(() => {
    if (ctx) setView(groupView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSyncCount]);

  const heading =
    typeof label === 'string' ? label : view === 'source' ? label?.source : label?.ai;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        {heading ? (
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            {heading}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {view === 'ai' && aiAction ? aiAction : null}
          {view === 'source' && sourceAction ? sourceAction : null}
          <Toggle view={view} setView={setView} sourceLabel={sourceLabel} aiLabel={aiLabel} />
        </div>
      </div>
      <div>{view === 'ai' ? ai : source}</div>
    </div>
  );
}
