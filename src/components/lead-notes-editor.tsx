'use client';

import { Button, Spinner } from '@heroui/react';
import { Check } from 'lucide-react';
import { useState, useTransition } from 'react';
import { updateLeadNotesAction } from '@/lib/leads/actions';

/**
 * Notes textarea + save button. HeroUI doesn't ship a Textarea
 * primitive so we keep the native <textarea> with consistent
 * Tailwind styling (matches site-instructions-editor.tsx), and use
 * the HeroUI Button for save with built-in `isPending` + spinner.
 */
export function LeadNotesEditor({
  leadId,
  initial
}: {
  leadId: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== initial && (value.trim() !== '' || initial !== '');

  function handleSubmit(formData: FormData): void {
    startTransition(async () => {
      await updateLeadNotesAction(formData);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1800);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-1.5">
      <input type="hidden" name="leadId" value={leadId} />
      <textarea
        name="notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Notes internes…"
        className="bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 text-xs w-60 resize-y focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          isDisabled={!dirty || isPending}
        >
          {isPending ? <Spinner size="sm" /> : 'Save'}
        </Button>
        {savedAt ? (
          <span className="text-[10px] text-[var(--success)] inline-flex items-center gap-1">
            <Check className="size-3" aria-hidden /> Sauvegardé
          </span>
        ) : null}
      </div>
    </form>
  );
}
