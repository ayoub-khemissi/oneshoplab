'use client';

import { Sparkles } from 'lucide-react';
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
  onGenerated
}: {
  generate: () => Promise<{ ok: true; alt: string } | { ok: false; error: string }>;
  onGenerated: (alt: string) => void;
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
            if (res.ok) onGenerated(res.alt);
            else setError(res.error);
          });
        }}
        testId="tile-generate-alt"
        disabled={pending}
        icon={<Sparkles className="size-3" />}
      >
        {pending ? t('generating') : t('generateTile')}
      </TileButton>
      {error ? (
        <p className="w-full text-[10px] leading-snug text-[var(--danger)]" role="alert">
          {messageFor(error)}
        </p>
      ) : null}
    </>
  );
}
