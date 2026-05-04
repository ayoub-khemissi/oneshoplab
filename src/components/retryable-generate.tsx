'use client';

import { Spinner, toast } from '@heroui/react';
import { Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { GenField } from './generate-button';

/**
 * App-wide retry policy for AI generations:
 *   - Attempt 1 fires immediately.
 *   - On failure: wait 2s, attempt 2 (label "2/3").
 *   - On failure: wait 5s, attempt 3 (label "3/3").
 *   - On failure: surface the last error message.
 * The user can cancel at any point — during a wait OR during an attempt
 * (`AbortController` on the underlying fetch).
 *
 * Only network errors and 5xx responses are retried. 4xx responses
 * (insufficient_credits, bad_request, …) are terminal — retrying won't
 * help and the message is shown to the user.
 */
const RETRY_DELAYS_MS = [2000, 5000] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 3

type State =
  | { kind: 'idle' }
  | { kind: 'pending'; field: GenField; attempt: number; startedAt: number }
  | { kind: 'waiting'; field: GenField; nextAttempt: number; resumeAt: number; lastError: string }
  | { kind: 'error'; field: GenField; message: string }
  | { kind: 'cancelled' }
  | { kind: 'success' };

interface ContextValue {
  state: State;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  submit: (field: GenField) => void;
  cancel: () => void;
}

const Ctx = createContext<ContextValue | null>(null);

interface ProviderProps {
  siteId: string;
  productId: string;
  children: ReactNode;
}

export function RetryableGenerateProvider({
  siteId,
  productId,
  children
}: ProviderProps) {
  const router = useRouter();
  const t = useTranslations('Product');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [customInstructions, setCustomInstructions] = useState('');

  // Active fetch's AbortController + a "user cancelled" flag the loop checks
  // so we don't kick off the next retry after a cancel landed mid-wait.
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setState({ kind: 'cancelled' });
    toast(t('generationCancelledTitle'));
  }, [t]);

  const submit = useCallback(
    async (field: GenField) => {
      cancelledRef.current = false;
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (cancelledRef.current) return;

        // Inter-attempt wait (skipped on first try).
        if (attempt > 1) {
          const delay = RETRY_DELAYS_MS[attempt - 2];
          setState({
            kind: 'waiting',
            field,
            nextAttempt: attempt,
            resumeAt: Date.now() + delay,
            lastError
          });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (cancelledRef.current) return;
        }

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setState({ kind: 'pending', field, attempt, startedAt: Date.now() });

        try {
          const res = await fetch('/api/products/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ siteId, productId, field, customInstructions }),
            signal: ctrl.signal
          });
          if (cancelledRef.current) return;

          if (res.ok) {
            setState({ kind: 'success' });
            toast.success(t('generationSuccessTitle'));
            router.refresh();
            return;
          }

          // Try to read a structured error; fall back to status text.
          let payload: { error?: string; message?: string } = {};
          try {
            payload = await res.json();
          } catch {
            // empty body or non-JSON
          }

          // 4xx → terminal: retrying won't help (auth, credits, validation).
          // Surface the matching i18n message in a toast so the user sees it
          // wherever they are on the page.
          if (res.status >= 400 && res.status < 500) {
            const code = payload.error ?? 'generation_failed';
            const message =
              code === 'insufficient_credits'
                ? t('errorInsufficientCredits')
                : t('errorGenerationFailed');
            toast.danger(message, { description: t('generationFailedTitle') });
            setState({ kind: 'error', field, message: code });
            return;
          }

          // 5xx → retryable.
          lastError = payload.message ?? payload.error ?? `HTTP ${res.status}`;
        } catch (e) {
          if (cancelledRef.current) return;
          // AbortError lands here too — but cancelledRef is set when the user
          // cancels, so we'd have returned above. Reach this branch only on
          // genuine network failure.
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      const message = lastError || 'generation_failed';
      setState({ kind: 'error', field, message });
      toast.danger(t('errorGenerationFailed'), { description: message });
    },
    [siteId, productId, customInstructions, router, t]
  );

  return (
    <Ctx.Provider
      value={{ state, customInstructions, setCustomInstructions, submit, cancel }}
    >
      {children}
    </Ctx.Provider>
  );
}

function useGenerateContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('RetryableGenerateButton used outside its provider');
  return ctx;
}

/** Tracks the wait between retries so we can show "next attempt in Xs". */
function useCountdownTo(targetMs: number | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (targetMs == null) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [targetMs]);
  return remaining;
}

/** Tracks how long the current attempt has been running. */
function useElapsedSinceMs(startMs: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startMs == null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [startMs]);
  return elapsed;
}

interface ButtonProps {
  field: GenField;
  cost: number;
  enabled: boolean;
  /** True when this field already has at least one prior AI generation. The
   *  button copy switches from "Generate" to "Regenerate" so the user
   *  understands they're overwriting / adding to existing output. */
  hasHistory?: boolean;
}

export function RetryableGenerateButton({
  field,
  cost,
  enabled,
  hasHistory = false
}: ButtonProps) {
  const t = useTranslations('Product');
  const { state, submit, cancel } = useGenerateContext();

  const isAll = field === 'all';
  const inflightField =
    state.kind === 'pending' || state.kind === 'waiting' ? state.field : null;
  const isThisOne = inflightField === field;
  const someoneElse = inflightField !== null && !isThisOne;

  const elapsed = useElapsedSinceMs(
    state.kind === 'pending' && state.field === field ? state.startedAt : null
  );
  const waitSeconds = useCountdownTo(
    state.kind === 'waiting' && state.field === field ? state.resumeAt : null
  );

  const baseClasses =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed';
  const enabledClasses = isAll
    ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-70'
    : 'border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60';
  const unaffordableClasses =
    'border border-[var(--border)] text-[var(--muted)] opacity-60 cursor-not-allowed';
  const classes = !enabled ? unaffordableClasses : enabledClasses;

  if (isThisOne && state.kind === 'pending') {
    return (
      <div className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${baseClasses} ${classes}`}>
          <Spinner size="sm" />
          <span>
            {t('generating', { seconds: elapsed })}
            <span className="opacity-70 font-mono ml-1">· {state.attempt}/{MAX_ATTEMPTS}</span>
          </span>
        </button>
        <CancelButton onCancel={cancel} label={t('cancelGeneration')} />
      </div>
    );
  }

  if (isThisOne && state.kind === 'waiting') {
    return (
      <div className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${baseClasses} ${classes}`}>
          <Spinner size="sm" />
          <span>
            {t('retryingIn', { seconds: waitSeconds })}
            <span className="opacity-70 font-mono ml-1">· {state.nextAttempt}/{MAX_ATTEMPTS}</span>
          </span>
        </button>
        <CancelButton onCancel={cancel} label={t('cancelGeneration')} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => submit(field)}
      disabled={!enabled || someoneElse}
      className={`${baseClasses} ${classes}`}
      title={!enabled ? t('insufficientCredits') : undefined}
    >
      {isAll ? (
        <>
          <Sparkles className="size-3.5" />
          <span>{hasHistory ? t('regenerateAll') : t('generateAll')}</span>
        </>
      ) : (
        <span>{hasHistory ? t('regenerateField') : t('generateField')}</span>
      )}
      <span className={`text-xs font-mono ${isAll ? 'opacity-80' : 'text-[var(--muted)]'}`}>
        · {t('creditsCost', { cost })}
      </span>
    </button>
  );
}

function CancelButton({ onCancel, label }: { onCancel: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
      aria-label={label}
      title={label}
    >
      <X className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Custom-instructions textarea controlled by the provider so its current
 * value is included with every generation request — no need for a `<form>`
 * around the buttons anymore.
 */
export function CustomInstructionsField() {
  const t = useTranslations('Product');
  const { customInstructions, setCustomInstructions } = useGenerateContext();
  return (
    <div className="flex flex-col gap-2 p-5 rounded-md border border-[var(--border)] bg-[var(--card)]">
      <label
        htmlFor="custom-instructions"
        className="text-xs uppercase tracking-wider text-[var(--muted)] font-mono"
      >
        {t('customInstructionsLabel')}
      </label>
      <textarea
        id="custom-instructions"
        name="customInstructions"
        rows={3}
        value={customInstructions}
        onChange={(e) => setCustomInstructions(e.target.value)}
        placeholder={t('customInstructionsPlaceholder')}
        className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[80px]"
      />
      <p className="text-xs text-[var(--muted)]">{t('customInstructionsHint')}</p>
    </div>
  );
}
