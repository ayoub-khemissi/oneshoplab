'use client';

import { Button, Card, Spinner } from '@heroui/react';
import { useState, useTransition } from 'react';
import { qualifyPastedUrlsAction } from '@/lib/leads/actions';

/**
 * Bulk paste form on the leads admin. Wrapped in a HeroUI Card,
 * native <textarea> for the URL list (HeroUI doesn't ship a
 * Textarea), HeroUI Button with isPending for the submit.
 */
export function LeadBulkPaste() {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData): void {
    startTransition(async () => {
      await qualifyPastedUrlsAction(formData);
      setValue('');
    });
  }

  const lineCount = value.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;

  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Coller des URLs à qualifier</h2>
        <span className="text-xs font-mono text-[var(--muted)] tabular-nums">
          {lineCount} URL{lineCount > 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)] leading-relaxed max-w-xl">
        Une URL par ligne. Les lignes commençant par <code>#</code> sont ignorées. Chaque URL passe
        par la même pipeline que le CLI (détection plateforme + récup d&apos;un produit + extraction
        email/socials). Max ≈25 URLs par paste pour rester sous la limite des server actions (60s).
      </p>
      <form action={handleSubmit} className="flex flex-col gap-3">
        <textarea
          name="urls"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={6}
          maxLength={20_000}
          placeholder="https://example.myshopify.com&#10;https://shop.example.com"
          className="bg-[var(--background)] border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y"
          required
        />
        <Button
          type="submit"
          variant="primary"
          isDisabled={lineCount === 0 || isPending}
          className="self-start"
        >
          {isPending ? <Spinner size="sm" /> : null}
          {isPending ? 'Qualification en cours…' : 'Qualifier'}
        </Button>
      </form>
    </Card>
  );
}
