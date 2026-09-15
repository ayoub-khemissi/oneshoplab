'use client';

/**
 * Output-ratio picker for image generation. Presentational and
 * domain-free on purpose: `shared` sits below `entities`, so the caller
 * builds the options from the model catalog and translates the copy,
 * and this component only draws the choice.
 *
 * Each option carries a preview box drawn at its real ratio — a merchant
 * picking "banner" is picking a shape, and a shape is faster to
 * recognise than the string "16:9".
 */

export interface ImageFormatOption {
  id: string;
  /** Translated name, e.g. "Square". */
  label: string;
  /** Ratio as the provider states it ('auto', '1:1', '9:16', '16:9'). */
  aspectRatio: string;
  /** One-line explanation of where the shape is used. */
  hint?: string;
}

/** Preview-box geometry, in px, for each ratio we can draw. `auto` has no
 *  fixed shape — it inherits the source photo's — so it gets a neutral
 *  square-ish frame with a dashed border to say "whatever comes in". */
function previewBox(aspectRatio: string): { w: number; h: number; dashed: boolean } {
  const [rawW, rawH] = aspectRatio.split(':');
  const w = Number.parseFloat(rawW);
  const h = Number.parseFloat(rawH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: 18, h: 18, dashed: true };
  }
  const MAX = 22;
  const scale = MAX / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale), dashed: false };
}

export function ImageFormatPicker({
  value,
  options,
  onChange,
  disabled = false,
  /** Rendered under the row — used to warn that a ratio caps the
   *  resolution before the merchant spends credits on it. */
  note,
  size = 'md'
}: {
  value: string;
  options: ImageFormatOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  note?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-stretch gap-1.5">
        {options.map((o) => {
          const active = o.id === value;
          const box = previewBox(o.aspectRatio);
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={o.hint ? `${o.label} · ${o.hint}` : o.label}
              onClick={() => {
                if (!active) onChange(o.id);
              }}
              className={`inline-flex items-center gap-2 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
              } ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)]/60'
              }`}
            >
              <span
                aria-hidden
                className={`shrink-0 rounded-[2px] ${
                  box.dashed ? 'border border-dashed' : 'border'
                } ${active ? 'border-[var(--accent)]' : 'border-[var(--muted)]'}`}
                style={{ width: box.w, height: box.h }}
              />
              <span className="font-medium whitespace-nowrap">{o.label}</span>
              {o.aspectRatio !== 'auto' ? (
                <span
                  className={`font-mono text-[10px] ${
                    active ? 'opacity-80' : 'text-[var(--muted)]'
                  }`}
                >
                  {o.aspectRatio}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {note ? <p className="text-[11px] text-[var(--warning)] leading-relaxed">{note}</p> : null}
    </div>
  );
}
