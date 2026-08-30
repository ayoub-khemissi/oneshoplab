'use client';

import { Spinner } from '@heroui/react';
import { Plus, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@/shared/db/schema';
import { CopyButton } from '@/shared/ui';
import { createManualWebhookAction, type WebhookActionError } from '../api/actions';

const field =
  'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';

/**
 * "Other integration": url + events → the secret comes back exactly once
 * (same reveal pattern as the site key: Copy + "I saved it").
 */
export function ManualWebhookForm({
  projectId,
  onCreated
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const t = useTranslations('Integrations.webhooks');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const [error, setError] = useState<WebhookActionError | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(event: WebhookEvent) {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (events.length === 0) {
      setError('bad_request');
      return;
    }
    startTransition(async () => {
      const res = await createManualWebhookAction({ projectId, url: url.trim(), events });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSecret(res.value.secret);
      setUrl('');
      onCreated();
    });
  }

  if (secret) {
    return (
      <div className="rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 p-4 flex flex-col gap-3">
        <span className="text-sm font-semibold inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-[var(--success)]" aria-hidden />
          {t('secretTitle')}
        </span>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{t('secretBody')}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <code
            data-testid="webhook-secret"
            className="text-xs font-mono px-2 py-1.5 rounded bg-[var(--background)] border border-[var(--border)] break-all select-all"
          >
            {secret}
          </code>
          <CopyButton value={secret} label={t('copy')} copiedLabel={t('copied')} size="md" />
        </div>
        <button
          type="button"
          onClick={() => setSecret(null)}
          className="self-start px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90"
        >
          {t('secretSaved')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} data-testid="manual-webhook-form" className="flex flex-col gap-3">
      <p className="text-sm text-[var(--muted)] leading-relaxed">{t('manualIntro')}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('urlLabel')}</span>
        <input
          name="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          autoComplete="off"
          spellCheck={false}
          required
          className={field}
        />
        <span className="text-xs text-[var(--muted)]">{t('urlHint')}</span>
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium mb-1">{t('eventsLabel')}</legend>
        {WEBHOOK_EVENTS.map((event) => (
          <label key={event} className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="events"
              value={event}
              checked={events.includes(event)}
              onChange={() => toggle(event)}
              className="size-4 accent-[var(--accent)]"
            />
            <span>{t(`event.${event}`)}</span>
            <code className="text-[11px] text-[var(--muted)] font-mono">{event}</code>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" data-testid="manual-webhook-error" className="text-sm text-[var(--danger)]">
          {t(`error.${error}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Spinner size="sm" /> : <Plus className="size-4" aria-hidden />}
        {pending ? t('creating') : t('create')}
      </button>
    </form>
  );
}
