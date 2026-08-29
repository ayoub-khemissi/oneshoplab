'use client';

import { Spinner } from '@heroui/react';
import { CheckCircle2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { RecaptchaWrapper } from '@/components/recaptcha-wrapper';
import { submitContactAction, type ContactFormState } from '@/lib/contact-actions';

interface ContactFormProps {
  locale: string;
  /** null = captcha disabled server-side (dev) → widget not rendered. */
  recaptchaSiteKey: string | null;
  /** Prefill for logged-in users. */
  defaults: { name: string; email: string };
}

const INITIAL: ContactFormState = { status: 'idle' };

const fieldClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none transition-all placeholder:text-[var(--field-placeholder)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15';

export function ContactForm({ locale, recaptchaSiteKey, defaults }: ContactFormProps) {
  const t = useTranslations('Contact');
  // Bumping the key remounts the form (and resets useActionState) for
  // "send another message" — simpler than threading a reset action.
  const [formKey, setFormKey] = useState(0);
  return (
    <InnerForm
      key={formKey}
      locale={locale}
      recaptchaSiteKey={recaptchaSiteKey}
      defaults={defaults}
      onReset={() => setFormKey((k) => k + 1)}
      t={t}
    />
  );
}

function InnerForm({
  locale,
  recaptchaSiteKey,
  defaults,
  onReset,
  t
}: ContactFormProps & { onReset: () => void; t: ReturnType<typeof useTranslations> }) {
  const [state, action, pending] = useActionState(submitContactAction, INITIAL);
  const v = state.values ?? {
    name: defaults.name,
    email: defaults.email,
    subject: '',
    message: ''
  };

  if (state.status === 'success') {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8 flex flex-col items-center text-center gap-3">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--success)]/15 text-[var(--success)]">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight">{t('successTitle')}</h2>
        <p className="text-sm text-[var(--muted)] max-w-md">{t('successBody')}</p>
        <button
          type="button"
          onClick={onReset}
          className="mt-2 text-sm text-[var(--accent)] hover:underline underline-offset-2"
        >
          {t('sendAnother')}
        </button>
      </div>
    );
  }

  const errorMessage =
    state.status === 'error'
      ? state.code === 'captcha'
        ? t('errorCaptcha')
        : state.code === 'rate_limited'
          ? t('errorRateLimited')
          : state.code === 'send_failed'
            ? t('errorSend')
            : t('errorInvalid')
      : null;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate={false}>
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot — visually hidden, off the tab order, never autofilled
          by browsers (autocomplete=off). Bots fill it; humans can't. */}
      <div className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden" aria-hidden>
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-name" className="text-sm font-medium">
            {t('nameLabel')}
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            defaultValue={v.name}
            placeholder={t('namePlaceholder')}
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-email" className="text-sm font-medium">
            {t('emailLabel')}
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            maxLength={255}
            autoComplete="email"
            inputMode="email"
            defaultValue={v.email}
            placeholder={t('emailPlaceholder')}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-subject" className="text-sm font-medium">
          {t('subjectLabel')}{' '}
          <span className="font-normal text-[var(--muted)]">({t('optional')})</span>
        </label>
        <input
          id="contact-subject"
          name="subject"
          type="text"
          maxLength={200}
          defaultValue={v.subject}
          placeholder={t('subjectPlaceholder')}
          className={fieldClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className="text-sm font-medium">
          {t('messageLabel')}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={7}
          defaultValue={v.message}
          placeholder={t('messagePlaceholder')}
          className={`${fieldClass} resize-y min-h-[9rem]`}
        />
      </div>

      {recaptchaSiteKey ? <RecaptchaWrapper siteKey={recaptchaSiteKey} /> : null}

      {errorMessage ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{t('privacyNote')}</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] font-medium hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {pending ? <Spinner size="sm" /> : <Send className="size-4" />}
          {pending ? t('sending') : t('submit')}
        </button>
      </div>
    </form>
  );
}
