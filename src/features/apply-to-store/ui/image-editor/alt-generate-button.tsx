'use client';

import { Coins, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { TileButton } from './tile-button';

/**
 * "Générer le texte alternatif" on one tile. The sentence it gets back is
 * queued as a `set_alt` right away and the field stays open on it, so the
 * merchant can edit it before the queue is sent (docs/api/IMAGE-OPS.md §4).
 * The error is shown here, in the merchant's words — the provider's message
 * never reaches this far.
 */
export function AltGenerateButton({
  generate,
  onGenerated,
  cost,
  hasAlt
}: {
  generate: () => Promise<
    { ok: true; alt: string; changeQueued?: boolean } | { ok: false; error: string }
  >;
  onGenerated: (alt: string, changeQueued: boolean) => void;
  /** Credits this click spends — shown on the button like every other paying
   *  action in the app, so nothing is ever debited by surprise. */
  cost: number;
  /** Drives the label: replacing an alt text is not the same promise as
   *  writing the first one. */
  hasAlt: boolean;
}) {
  const t = useTranslations('AltText');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function messageFor(code: string): string {
    switch (code) {
      case 'insufficient_credits':
        return t('errorInsufficientCredits');
      case 'unsupported':
        return t('errorUnsupported');
      case 'archived':
        return t('errorArchived');
      default:
        return t('errorGeneric');
    }
  }

  return (
    <>
      <TileButton
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await generate();
            if (res.ok) onGenerated(res.alt, res.changeQueued === true);
            else setError(res.error);
          });
        }}
        testId="tile-generate-alt"
        disabled={pending}
        icon={<Sparkles className="size-3" />}
      >
        {pending ? (
          t('generating')
        ) : (
          <>
            {hasAlt ? t('regenerateTile') : t('generateTile')}
            <span className="inline-flex items-center gap-0.5 font-mono text-[10px] opacity-70">
              <Coins className="size-2.5" aria-hidden />
              {cost}
            </span>
          </>
        )}
      </TileButton>
      {error ? (
        <p className="w-full text-[10px] leading-snug text-[var(--danger)]" role="alert">
          {messageFor(error)}
        </p>
      ) : null}
    </>
  );
}
