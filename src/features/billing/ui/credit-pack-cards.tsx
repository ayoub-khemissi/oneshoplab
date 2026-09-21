import { Card } from '@heroui/react';
import { Coins, Sparkles } from 'lucide-react';
import { bestValuePack, CREDIT_PACKS, packPerCreditEur } from '@/entities/ai-model';
import { buyCreditPackAction } from '../api/actions';
import { getStripePackPriceId } from '../api/stripe';

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
    /** Badge on the pack with the lowest price per credit. Optional: the
     *  account page lists packs without ranking them. */
    bestValueLabel?: string;
  };
  /** BCP-47 tag for number formatting (falls back to the runtime default). */
  locale?: string;
}

/**
 * Three-pack grid (Boost / Power / Mega). Server-rendered: the buy
 * action handles unauthenticated users itself by redirecting to
 * /login?next=/account/credits, so this component doesn't need to
 * branch on session state.
 */
export function CreditPackCards({ copy, locale }: CreditPackCardsProps) {
  const best = bestValuePack().id;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {CREDIT_PACKS.map((pack) => {
        const configured = getStripePackPriceId(pack.id) !== null;
        const isBest = copy.bestValueLabel !== undefined && pack.id === best;
        const packCopy = copy.pack[pack.id] ?? {
          name: pack.name,
          tagline: ''
        };
        return (
          <div key={pack.id} className="relative flex">
            {isBest ? (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold whitespace-nowrap shadow-sm">
                {copy.bestValueLabel}
              </span>
            ) : null}
            <Card
              variant="secondary"
              className={`p-5 flex flex-col gap-4 w-full ${isBest ? 'border-2 border-[var(--accent)]' : ''}`}
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-bold tracking-tight">{packCopy.name}</h3>
                <p className="text-xs text-[var(--muted)]">{packCopy.tagline}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-bold tabular-nums inline-flex items-center gap-1.5">
                  <Coins className="size-6 text-[var(--accent)]" aria-hidden />
                  {pack.credits.toLocaleString(locale)}
                </span>
                <span className="text-xs text-[var(--muted)] font-mono uppercase tracking-wider">
                  {copy.creditsLabel}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold">€{pack.priceEur.toFixed(2)}</span>
                <span className="text-xs text-[var(--muted)]">
                  {copy.perCreditLabel(packPerCreditEur(pack).toFixed(4))}
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
          </div>
        );
      })}
    </div>
  );
}
