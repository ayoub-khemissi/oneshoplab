import { ChevronLeft } from 'lucide-react';

export function ScoreBadge({ score }: { score: number }) {
  const accent =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span
      className={`font-mono rounded-full font-semibold whitespace-nowrap transition-[padding,font-size] duration-200 text-xs md:text-sm px-2 py-0.5 md:px-3 md:py-1 group-data-[compact=true]/sticky:text-xs group-data-[compact=true]/sticky:px-2 group-data-[compact=true]/sticky:py-0.5 ${accent}`}
    >
      {score}/100
    </span>
  );
}

export function BackArrow() {
  return (
    <ChevronLeft
      className="size-4 shrink-0 transition-[width,height] duration-200 group-data-[compact=true]/sticky:size-3.5"
      aria-hidden
    />
  );
}
