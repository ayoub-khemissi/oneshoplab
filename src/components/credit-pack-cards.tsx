import { Card } from '@heroui/react';
import { Sparkles } from 'lucide-react';
import { CREDIT_PACKS } from '@/lib/ai/models';
import { buyCreditPackAction } from '@/lib/stripe-actions';
import { getStripePackPriceId } from '@/lib/stripe';

interface CreditPackCardsProps {
  /** Copy bag — server-translated by the caller so this component can
   *  be a server component (no useTranslations) and renders inside both
   *  /account/credits and /pricing. */
  copy: {
    /** Free-form per-pack name + tagline, keyed by pack id. */
    pack: Record<string, { name: string; tagline: string }>;
    creditsLabel: string;
    buyLabel: string;
    comingSoonLabel: string;
    perCreditLabel: (perCredit: string) => string;
  };
}

/**
 * Three-pack grid (Boost / Power / Mega). Server-rendered: the buy
 * action handles unauthenticated users itself by redirecting to
 * /login?next=/account/credits, so this component doesn't need to
 * branch on session state.
 */
export function CreditPackCards({ copy }: CreditPackCardsProps) {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {CREDIT_PACKS.map((pack) => {
        const configured = getStripePackPriceId(pack.id) !== null;
        const packCopy = copy.pack[pack.id] ?? {
          name: pack.name,
          tagline: ''
        };
        return (
          <Card
            key={pack.id}
            variant="secondary"
            className="p-5 flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold tracking-tight">
                {packCopy.name}
              </h3>
              <p className="text-xs text-[var(--muted)]">{packCopy.tagline}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-3xl font-bold tabular-nums">
                {pack.credits.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--muted)] font-mono uppercase tracking-wider">
                {copy.creditsLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold">€{pack.priceEur.toFixed(2)}</span>
              <span className="text-xs text-[var(--muted)]">
                {copy.perCreditLabel((pack.priceEur / pack.credits).toFixed(4))}
              </span>
            </div>
            <form action={buyCreditPackAction} className="mt-auto">
              <input type="hidden" name="packId" value={pack.id} />
              <button
                type="submit"
                disabled={!configured}
                className="w-full px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                <Sparkles className="size-3.5" />
                {configured ? copy.buyLabel : copy.comingSoonLabel}
              </button>
            </form>
          </Card>
        );
      })}
    </div>
  );
}
