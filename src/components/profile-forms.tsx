'use client';

import { Spinner } from '@heroui/react';
import { AlertCircle, Check } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  changePasswordAction,
  deleteAccountAction,
  updateUserProfileAction
} from '@/lib/auth-actions';

const SAVED_FLASH_MS = 2500;

/**
 * Client wrappers around the profile server actions so each form gets the
 * inline "Saved ✓" flash + inline error pattern used elsewhere in the app
 * (ModelPreferencesForm, SiteInstructionsEditor). Server actions return a
 * tagged { ok, errorCode } shape; the client maps errorCode to a localised
 * message.
 */

export function ProfileNameForm({
  initialName,
  email,
  copy
}: {
  initialName: string;
  email: string;
  copy: {
    identityTitle: string;
    emailLabel: string;
    emailHint: string;
    nameLabel: string;
    namePlaceholder: string;
    saveButton: string;
    saved: string;
  };
}) {
  const [name, setName] = useState(initialName);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updateUserProfileAction(formData);
      if (res.ok) {
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
      }
    });
  }

  return (
    <Card title={copy.identityTitle}>
      <form action={handleSubmit} className="flex flex-col gap-3">
        <Field label={copy.emailLabel}>
          <input
            type="email"
            value={email}
            readOnly
            disabled
            className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--default)]/30 text-sm cursor-not-allowed"
          />
          <p className="text-xs text-[var(--muted)]">{copy.emailHint}</p>
        </Field>
        <Field label={copy.nameLabel}>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={copy.namePlaceholder}
            className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition"
          />
        </Field>
        <FormFooter
          isPending={isPending}
          savedAt={savedAt}
          savedLabel={copy.saved}
          submitLabel={copy.saveButton}
        />
      </form>
    </Card>
  );
}

export function ProfilePasswordForm({
  copy
}: {
  copy: {
    passwordTitle: string;
    currentPasswordLabel: string;
    newPasswordLabel: string;
    newPasswordHint: string;
    confirmNewPasswordLabel: string;
    changePasswordButton: string;
    saved: string;
    errors: Record<string, string>;
  };
}) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await changePasswordAction(formData);
      if (res.ok) {
        setErrorCode(null);
        setSavedAt(Date.now());
        // Reset the form fields by reload of the form's parent (the
        // closest <form> reset doesn't help because the inputs are
        // uncontrolled). We just clear the saved flash; the user can
        // retype if they want to change again.
        setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
      } else {
        setErrorCode(res.errorCode ?? 'generic');
        setSavedAt(null);
      }
    });
  }

  return (
    <Card title={copy.passwordTitle}>
      <form action={handleSubmit} className="flex flex-col gap-3">
        <Field label={copy.currentPasswordLabel}>
          <PasswordInput name="currentPassword" autoComplete="current-password" />
        </Field>
        <Field label={copy.newPasswordLabel}>
          <PasswordInput name="newPassword" autoComplete="new-password" min={8} />
          <p className="text-xs text-[var(--muted)]">{copy.newPasswordHint}</p>
        </Field>
        <Field label={copy.confirmNewPasswordLabel}>
          <PasswordInput name="confirmPassword" autoComplete="new-password" min={8} />
        </Field>
        {errorCode ? (
          <ErrorLine message={copy.errors[errorCode] ?? copy.errors.generic} />
        ) : null}
        <FormFooter
          isPending={isPending}
          savedAt={savedAt}
          savedLabel={copy.saved}
          submitLabel={copy.changePasswordButton}
        />
      </form>
    </Card>
  );
}

export function AccountDeleteForm({
  hasActiveSubscription,
  email,
  copy
}: {
  hasActiveSubscription: boolean;
  /** Current user's email — surfaced as the placeholder so the user
   *  knows exactly what to retype. Compared server-side too. */
  email: string;
  copy: {
    dangerTitle: string;
    dangerBody: string;
    dangerActiveSub: string;
    deleteEmailConfirmLabel: string;
    deleteEmailConfirmHint: string;
    deleteAccountButton: string;
    errors: Record<string, string>;
  };
}) {
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [isPending, startTransition] = useTransition();

  // Client-side gate so the destructive button only enables when the
  // typed email matches exactly. Server still re-validates.
  const matches = typed.toLowerCase().trim() === (email ?? '').toLowerCase().trim();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await deleteAccountAction(formData);
      // On success the action redirects, this branch is never reached.
      if (!res?.ok) {
        setErrorCode(res?.errorCode ?? 'generic');
      }
    });
  }

  return (
    <div className="rounded-md border border-[var(--danger)]/40 bg-[var(--card)] p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--danger)]">
        {copy.dangerTitle}
      </h2>
      <p className="text-sm text-[var(--muted)]">{copy.dangerBody}</p>
      {hasActiveSubscription ? (
        <p className="text-xs text-[var(--warning)] inline-flex items-start gap-1.5">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          {copy.dangerActiveSub}
        </p>
      ) : null}
      <form action={handleSubmit} className="flex flex-col gap-3">
        <Field label={copy.deleteEmailConfirmLabel} hint={copy.deleteEmailConfirmHint}>
          <input
            type="email"
            name="email_confirmation"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              if (errorCode) setErrorCode(null);
            }}
            autoComplete="off"
            placeholder={email}
            disabled={hasActiveSubscription}
            className="w-full px-3 py-2 rounded-md text-sm bg-[var(--background)] border border-[var(--danger)]/40 focus:border-[var(--danger)] focus:outline-none disabled:opacity-50"
          />
        </Field>
        {errorCode ? (
          <ErrorLine message={copy.errors[errorCode] ?? copy.errors.generic} />
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending || hasActiveSubscription || !matches}
            className="px-4 py-2 rounded-md bg-[var(--danger)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isPending ? <Spinner size="sm" /> : null}
            {copy.deleteAccountButton}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Internals ------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--muted)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint ? (
        <span className="text-xs text-[var(--muted)] leading-relaxed">{hint}</span>
      ) : null}
    </label>
  );
}

function PasswordInput({
  name,
  autoComplete,
  min = 8,
  disabled = false,
  danger = false
}: {
  name: string;
  autoComplete: string;
  min?: number;
  disabled?: boolean;
  danger?: boolean;
}) {
  const focusRing = danger
    ? 'focus:border-[var(--danger)] focus:ring-[var(--danger)]/20'
    : 'focus:border-[var(--accent)] focus:ring-[var(--accent)]/20';
  return (
    <input
      type="password"
      name={name}
      required
      minLength={min}
      maxLength={128}
      autoComplete={autoComplete}
      disabled={disabled}
      className={`w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:outline-none focus:ring-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}
    />
  );
}

function FormFooter({
  isPending,
  savedAt,
  savedLabel,
  submitLabel
}: {
  isPending: boolean;
  savedAt: number | null;
  savedLabel: string;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      {savedAt ? (
        <span className="text-xs text-[var(--success)] font-medium inline-flex items-center gap-1.5">
          <Check className="size-3.5" /> {savedLabel}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        {isPending ? <Spinner size="sm" /> : null}
        {submitLabel}
      </button>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="text-xs text-[var(--danger)] inline-flex items-start gap-1.5"
    >
      <AlertCircle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

