import { ChevronLeft } from 'lucide-react';

export function ScoreBadge({ score }: { score: number }) {
  const accent =
    score >= 75
      ? 'bg-[var(--success)]/10 text-[var(--success)]'
      : score >= 50
        ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
        : 'bg-[var(--danger)]/10 text-[var(--danger)]';
  return (
    <span className={`text-sm font-mono px-3 py-1 rounded-full font-semibold ${accent}`}>
      {score}/100
    </span>
  );
}

export function BackArrow() {
  return <ChevronLeft className="size-4" aria-hidden />;
}
