'use client';

import { Spinner, toast } from '@heroui/react';
import { Coins, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFieldSwapGroup, useFieldView } from '@/components/field-swap';
import { trackEvent } from '@/lib/analytics-event';
import { sanitizeUserFacingError } from '@/lib/errors';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  costForImage,
  estimateChatCredits,
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai/models';
import type { GenField } from './generate-button';

const IMAGE_ANGLES_PER_GEN = 3;

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

type FieldState =
  | { kind: 'idle' }
  | { kind: 'pending'; attempt: number; startedAt: number }
  | { kind: 'waiting'; nextAttempt: number; resumeAt: number; lastError: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'success' };

const FIELDS: GenField[] = ['title', 'description', 'tags', 'images', 'all'];

const IDLE_STATES = (): Record<GenField, FieldState> =>
  FIELDS.reduce(
    (acc, f) => {
      acc[f] = { kind: 'idle' };
      return acc;
    },
    {} as Record<GenField, FieldState>
  );

function isInflight(s: FieldState): boolean {
  return s.kind === 'pending' || s.kind === 'waiting';
}

interface ContextValue {
  states: Record<GenField, FieldState>;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  submit: (field: GenField) => void;
  cancel: (field: GenField) => void;
  // Live model selection — drives both the cost displayed on the buttons and
  // the chatModelId / imageQualityId sent to /api/products/generate.
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  setChatModelId: (id: ChatModelId) => void;
  setImageQualityId: (id: ImageQualityId) => void;
  creditsBalance: number;
  costFor: (field: GenField) => number;
  canAfford: (field: GenField) => boolean;
  productArchived: boolean;
}

const Ctx = createContext<ContextValue | null>(null);

interface ProviderProps {
  siteId: string;
  productId: string;
  initialChatModelId: ChatModelId;
  initialImageQualityId: ImageQualityId;
  /** Last instructions persisted on the product — pre-fills the textarea
   *  so the merchant doesn't lose their guidance between visits. */
  initialCustomInstructions?: string;
  creditsBalance: number;
  /** Archived product: every Generate / Regenerate CTA is force-disabled
   *  regardless of credit balance because there's no point producing
   *  content for a product no longer present on the merchant's store. */
  productArchived?: boolean;
  /** Chat fields with a 'running' job row at mount time, plus the real
   *  startedAt of the submit. After an F5 the original client fetch is
   *  gone but the server is still finishing the kie chat (~30s sync);
   *  restoring the spinner per in-flight field — and using the real
   *  startedAt so the elapsed counter doesn't reset to 0 — keeps the
   *  merchant in the loop. The provider polls /api/products/text-jobs
   *  until the row flips to completed/failed. */
  inFlightChatJobs?: Array<{
    field: 'title' | 'description' | 'tags';
    startedAtMs: number;
  }>;
  /** Chat fields whose LAST attempt within the recent recovery window
   *  ended in 'failed'. The provider fires a single sanitised toast
   *  per failed job on mount (dedup'd via localStorage on jobId), so
   *  the merchant sees the failure they missed during F5 instead of
   *  silently looking at an idle Generate button. */
  recentFailedChatJobs?: Array<{
    jobId: string;
    field: 'title' | 'description' | 'tags';
    error: string;
  }>;
  children: ReactNode;
}

export function RetryableGenerateProvider({
  siteId,
  productId,
  initialChatModelId,
  initialImageQualityId,
  initialCustomInstructions = '',
  creditsBalance,
  productArchived = false,
  inFlightChatJobs = [],
  recentFailedChatJobs = [],
  children
}: ProviderProps) {
  const router = useRouter();
  const t = useTranslations('Product');
  // One slot per field so a Description rewrite doesn't lock the
  // Title button — each generation is genuinely independent. The
  // 'all' slot is special: a running 'all' grabs every field at
  // once, so it acts as a global lock at the button-disable layer
  // (see RetryableGenerateButton below).
  // F5-resume seed: any field with a server-side 'running' chat job
  // re-enters as 'pending' so the spinner is back on first paint.
  // Uses the REAL startedAt from the job row, so the elapsed counter
  // shows continuity across the reload (e.g. "Generating · 38s")
  // instead of restarting from 0.
  const [states, setStates] = useState<Record<GenField, FieldState>>(() => {
    const seed = IDLE_STATES();
    for (const job of inFlightChatJobs) {
      seed[job.field] = {
        kind: 'pending',
        attempt: 1,
        startedAt: job.startedAtMs
      };
    }
    return seed;
  });
  const setFieldState = useCallback((field: GenField, next: FieldState) => {
    setStates((prev) => ({ ...prev, [field]: next }));
  }, []);

  // Resume-from-F5 poll: when the page mounts with one or more chat
  // jobs still 'running' server-side, the original submit's fetch is
  // gone (the previous tab closed on reload), so the provider has no
  // way to know when the server finishes. Poll a lightweight endpoint
  // every 2.5s and router.refresh() once every resumed field has
  // flipped off — the refresh re-fetches inFlightChatJobs and
  // unsticks the spinner naturally. The poll only runs for fields
  // that came back pending from the server, never for ones the user
  // clicks in-tab.
  const resumedRef = useRef<Set<GenField>>(
    new Set(inFlightChatJobs.map((j) => j.field))
  );
  useEffect(() => {
    if (resumedRef.current.size === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/products/text-jobs?productId=${encodeURIComponent(productId)}`, {
          headers: { accept: 'application/json' }
        });
        if (cancelled) return;
        if (!res.ok) return;
        const body = (await res.json()) as { running?: string[] };
        const stillRunning = new Set(body.running ?? []);
        // Drop the resumed marker on any field the server no longer
        // reports as running — that field's job has flipped to
        // completed or failed. We refresh once to pick up the new
        // product state (description text, etc.).
        let cleared = 0;
        for (const f of Array.from(resumedRef.current)) {
          if (!stillRunning.has(f)) {
            resumedRef.current.delete(f);
            cleared += 1;
          }
        }
        if (cleared > 0) router.refresh();
      } catch {
        // Network hiccup — keep polling; the poll loop is best-effort.
      }
    };
    const id = window.setInterval(tick, 2500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // We intentionally do NOT depend on `states` here — the resumed
    // tracker is its own bag, fed only by the F5 seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, router]);

  // Surface chat-gen failures the merchant may have missed while
  // their tab was reloading. The server already filtered to "last
  // attempt per field, failed" within the recovery window; we just
  // need to fire one toast per jobId on mount and remember which IDs
  // we've already shown so a second F5 inside the same window doesn't
  // re-spam. localStorage keeps the dedup per-browser (sessionStorage
  // would forget across tabs, which is too narrow — we want "stop
  // showing this failure" to mean "across reloads", not "per tab").
  useEffect(() => {
    if (recentFailedChatJobs.length === 0) return;
    const SEEN_KEY = 'oneshoplab.chat-fail-seen';
    let seen: Set<string>;
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      seen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      seen = new Set();
    }
    let dirty = false;
    for (const job of recentFailedChatJobs) {
      if (seen.has(job.jobId)) continue;
      seen.add(job.jobId);
      dirty = true;
      // Reuse the generic 'errorGenerationFailed' i18n key (already
      // present in all 13 locales) — adding per-field variants would
      // require 39 new translations and the UI doesn't gain much:
      // the user is on the product page, will retry, and the
      // attempted field is the one they last interacted with.
      toast.danger(t('errorGenerationFailed'));
      // Mark the failure notification as read — user has now
      // explicitly seen the failure (via toast). Best-effort.
      void fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId })
      });
    }
    if (dirty) {
      try {
        // Bound the set so it doesn't grow unboundedly across months
        // of failures. 200 entries is plenty for a single merchant.
        const arr = Array.from(seen).slice(-200);
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
      } catch {
        // Quota / privacy mode — silently skip persistence.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [customInstructions, setCustomInstructions] = useState(initialCustomInstructions);
  const [chatModelId, setChatModelId] = useState<ChatModelId>(initialChatModelId);
  const [imageQualityId, setImageQualityId] = useState<ImageQualityId>(initialImageQualityId);

  // Refs so submit() always reads the latest selection without re-creating
  // the callback (which would also re-create every memoized child).
  const chatModelRef = useRef(chatModelId);
  const imageQualityRef = useRef(imageQualityId);
  useEffect(() => { chatModelRef.current = chatModelId; }, [chatModelId]);
  useEffect(() => { imageQualityRef.current = imageQualityId; }, [imageQualityId]);

  const costFor = useCallback(
    (field: GenField): number => {
      const cm = chatModelId;
      const iq = imageQualityId;
      const t = estimateChatCredits(cm, 'title');
      const d = estimateChatCredits(cm, 'description');
      const tg = estimateChatCredits(cm, 'tags');
      const img = costForImage(iq) * IMAGE_ANGLES_PER_GEN;
      switch (field) {
        case 'title': return t;
        case 'description': return d;
        case 'tags': return tg;
        case 'images': return img;
        case 'all': return t + d + tg + img;
      }
    },
    [chatModelId, imageQualityId]
  );

  const canAfford = useCallback(
    (field: GenField) => creditsBalance >= costFor(field),
    [creditsBalance, costFor]
  );

  // Per-field abort controllers + cancel flags. A submit running on
  // field X needs to be cancellable without disturbing a concurrent
  // submit on field Y — so each slot tracks its own pair.
  const abortRefs = useRef<Partial<Record<GenField, AbortController>>>({});
  const cancelledRefs = useRef<Partial<Record<GenField, boolean>>>({});

  const cancel = useCallback(
    (field: GenField) => {
      cancelledRefs.current[field] = true;
      abortRefs.current[field]?.abort();
      setFieldState(field, { kind: 'cancelled' });
      toast(t('generationCancelledTitle'));
    },
    [t, setFieldState]
  );

  const submit = useCallback(
    async (field: GenField) => {
      cancelledRefs.current[field] = false;
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (cancelledRefs.current[field]) return;

        // Inter-attempt wait (skipped on first try).
        if (attempt > 1) {
          const delay = RETRY_DELAYS_MS[attempt - 2];
          setFieldState(field, {
            kind: 'waiting',
            nextAttempt: attempt,
            resumeAt: Date.now() + delay,
            lastError
          });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (cancelledRefs.current[field]) return;
        }

        const ctrl = new AbortController();
        abortRefs.current[field] = ctrl;
        setFieldState(field, { kind: 'pending', attempt, startedAt: Date.now() });

        // For 'all' and 'images', the server queues async image jobs
        // before chat finishes (chat is sync, ~30s). Notify the live
        // image grid to start polling immediately so the merchant sees
        // the 3 skeleton placeholders within ~1s of clicking, instead
        // of waiting for the request to return + router.refresh().
        if (typeof window !== 'undefined' && (field === 'all' || field === 'images')) {
          window.dispatchEvent(
            new CustomEvent('oneshoplab:kick-image-poll', {
              detail: { siteId, productId }
            })
          );
        }

        try {
          const res = await fetch('/api/products/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              siteId,
              productId,
              field,
              customInstructions,
              // Send the live selection so an in-flight chip click is
              // honored even before the persist server action lands.
              chatModelId: chatModelRef.current,
              imageQualityId: imageQualityRef.current
            }),
            signal: ctrl.signal
          });
          if (cancelledRefs.current[field]) return;

          if (res.ok) {
            setFieldState(field, { kind: 'success' });
            toast.success(t('generationSuccessTitle'));
            // Mark the just-fired notification as read — user saw the
            // toast. Best-effort: don't block the UI on the call.
            try {
              const ok = (await res.clone().json()) as { chatJobIds?: string[] };
              if (ok.chatJobIds?.length) {
                void Promise.all(
                  ok.chatJobIds.map((jobId) =>
                    fetch('/api/notifications/mark-read', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ jobId })
                    })
                  )
                );
              }
            } catch {
              // Non-JSON / empty body — skip.
            }
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
            setFieldState(field, { kind: 'error', message: code });
            return;
          }

          // 5xx — normally retryable, but 'all' and 'images' kick off
          // kie image jobs via Promise.allSettled BEFORE the response
          // is returned. A 5xx after the queue (e.g. nginx timeout on
          // a long chat phase) means the image jobs already exist; a
          // retry would create another 3 image jobs and burn credits
          // a second time. So for those fields we treat 5xx as
          // terminal — the user can re-click manually after checking
          // what's already running. Per-field chat generations
          // (title / description / tags) are safe to auto-retry
          // because they only persist on success.
          if (field === 'all' || field === 'images') {
            const raw = payload.message ?? payload.error ?? `HTTP ${res.status}`;
            // Defence-in-depth: server already sanitises, but if a
            // new error surface forgets to, the user still never sees
            // "kie …" or our vendor names. Title is enough — drop the
            // description on transient failures so we don't leak
            // internal status detail either.
            toast.danger(t('errorGenerationFailed'));
            setFieldState(field, { kind: 'error', message: sanitizeUserFacingError(raw) });
            return;
          }

          lastError = payload.message ?? payload.error ?? `HTTP ${res.status}`;
        } catch (e) {
          if (cancelledRefs.current[field]) return;
          // AbortError lands here too — but cancelledRef is set when the user
          // cancels, so we'd have returned above. Reach this branch only on
          // genuine network failure.
          // Same safety as the 5xx branch above: if the request reached the
          // server before the connection dropped, image jobs were already
          // queued and a retry would duplicate them. We can't tell from a
          // network error whether the server processed it or not, so we
          // play it safe for 'all' / 'images'.
          if (field === 'all' || field === 'images') {
            const raw = e instanceof Error ? e.message : String(e);
            toast.danger(t('errorGenerationFailed'));
            setFieldState(field, { kind: 'error', message: sanitizeUserFacingError(raw) });
            return;
          }
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      const safeMessage = sanitizeUserFacingError(lastError || 'generation_failed');
      setFieldState(field, { kind: 'error', message: safeMessage });
      // Title-only — at this point the user has lived through 3
      // silent retries; a wall of vendor noise in the description
      // doesn't help them. The internal state keeps the sanitised
      // message for any UI that wants to display it inline.
      toast.danger(t('errorGenerationFailed'));
    },
    [siteId, productId, customInstructions, router, t, setFieldState]
  );

  const value = useMemo<ContextValue>(
    () => ({
      states,
      customInstructions,
      setCustomInstructions,
      submit,
      cancel,
      chatModelId,
      imageQualityId,
      setChatModelId,
      setImageQualityId,
      creditsBalance,
      costFor,
      canAfford,
      productArchived
    }),
    [
      states,
      customInstructions,
      submit,
      cancel,
      chatModelId,
      imageQualityId,
      creditsBalance,
      costFor,
      canAfford,
      productArchived
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGenerateContext(): ContextValue {
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
  /** True when this field already has at least one prior AI generation. The
   *  button copy switches from "Generate" to "Regenerate" so the user
   *  understands they're overwriting / adding to existing output. */
  hasHistory?: boolean;
  /** Optional gate on top of the credit-based affordance check (e.g. "no
   *  source images → can't regenerate images"). Defaults to true. */
  available?: boolean;
}

export function RetryableGenerateButton({
  field,
  hasHistory = false,
  available = true
}: ButtonProps) {
  const t = useTranslations('Product');
  const { states, submit, cancel, costFor, canAfford, productArchived } = useGenerateContext();
  // Per-field view scope (FieldRow) and panel-level view scope
  // (FieldSwapGroup) — both optional. We use them to auto-flip the
  // view to "AI" when a generation is launched, so the merchant
  // lands directly on the freshly-running output instead of
  // staring at the source side while their click does nothing
  // visible.
  const fieldView = useFieldView();
  const groupView = useFieldSwapGroup();
  const state = states[field];
  const allState = states.all;
  const cost = costFor(field);
  const enabled = available && canAfford(field) && !productArchived;

  const launchSubmit = useCallback(() => {
    // Activation metric — a user-initiated AI generation launch.
    trackEvent('generate', { field });
    if (field === 'all') {
      // Flip every section to the AI view in a single shot via the
      // group context — bumps syncCount, every FieldSwap / per-field
      // provider rehydrates from the new group view.
      groupView?.setView('ai');
    } else {
      // Per-section: flip just this section. The FieldViewProvider
      // wrapping this row carries the state, no leak to siblings.
      fieldView?.setView('ai');
    }
    submit(field);
  }, [field, fieldView, groupView, submit]);
  // Confirmation dialog only on the "Generate / Regenerate everything"
  // button. Per-field actions go through directly — they're cheap
  // single-shot calls and their cost is already on the button label.
  // The all-button hits 4-5 generations at once + can overwrite
  // existing outputs on regenerate, hence the explicit prompt.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isAll = field === 'all';
  // This specific field is in flight (clicking "Title" while title runs
  // shows the spinner here, not on Description).
  const isThisOne = isInflight(state);
  // Global lock: when the "Generate all" button is running, every
  // single-field button locks because that's exactly what 'all' is
  // doing server-side. For the 'all' button itself, lock when any
  // *other* field is running too — running a chat + image lane in
  // parallel is fine, but kicking off another "all" on top is not.
  const allInflight = isInflight(allState);
  const otherSingleInflight = isAll
    ? FIELDS.some((f) => f !== 'all' && isInflight(states[f]))
    : false;
  const blockedByGlobal =
    (!isAll && allInflight) || (isAll && otherSingleInflight);

  const elapsed = useElapsedSinceMs(
    state.kind === 'pending' ? state.startedAt : null
  );
  const waitSeconds = useCountdownTo(
    state.kind === 'waiting' ? state.resumeAt : null
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
    // Hide the "X/3" badge on attempt 1 — surfacing "1/3" before anything
    // has even failed reads as a retry counter to the user. Show it only
    // when we're actually retrying.
    const showAttemptBadge = state.attempt > 1;
    return (
      <div className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${baseClasses} ${classes}`}>
          <Spinner size="sm" />
          <span>
            {t('generating', { seconds: elapsed })}
            {showAttemptBadge ? (
              <span className="opacity-70 font-mono ml-1">· {state.attempt}/{MAX_ATTEMPTS}</span>
            ) : null}
          </span>
        </button>
        <CancelButton onCancel={() => cancel(field)} label={t('cancelGeneration')} />
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
        <CancelButton onCancel={() => cancel(field)} label={t('cancelGeneration')} />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (isAll ? setConfirmOpen(true) : launchSubmit())}
        disabled={!enabled || blockedByGlobal}
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
        <span className={`text-xs font-mono inline-flex items-center gap-1 ${isAll ? 'opacity-80' : 'text-[var(--muted)]'}`}>
          · <Coins className="size-3" aria-hidden /> {cost}
        </span>
      </button>
      {isAll ? (
        <ConfirmDialog
          isOpen={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={
            hasHistory
              ? t('confirmRegenerateAllTitle')
              : t('confirmGenerateAllTitle')
          }
          description={
            hasHistory
              ? t('confirmRegenerateAllBody', { cost })
              : t('confirmGenerateAllBody', { cost })
          }
          confirmLabel={hasHistory ? t('regenerateAll') : t('generateAll')}
          cancelLabel={t('cancelGeneration')}
          destructive={hasHistory}
          onConfirm={launchSubmit}
        />
      ) : null}
    </>
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
interface CustomInstructionsFieldProps {
  /** When the project carries site-wide instructions, surface a notice so
   *  the merchant knows extra guidance is being added on top of theirs. */
  hasSiteInstructions?: boolean;
}

export function CustomInstructionsField({ hasSiteInstructions = false }: CustomInstructionsFieldProps) {
  const t = useTranslations('Product');
  const { customInstructions, setCustomInstructions } = useGenerateContext();
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="custom-instructions"
        className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
      >
        {t('customInstructionsLabel')}
      </label>
      <textarea
        id="custom-instructions"
        name="customInstructions"
        rows={3}
        maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(e) => setCustomInstructions(e.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS))}
        placeholder={t('customInstructionsPlaceholder')}
        className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[80px]"
      />
      <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--muted)]">
        <p>
          {t('customInstructionsHint')}
          {hasSiteInstructions ? ` ${t('customInstructionsSiteHint')}` : ''}
        </p>
        <span className="font-mono shrink-0 tabular-nums">
          {customInstructions.length}/{MAX_CUSTOM_INSTRUCTIONS_CHARS}
        </span>
      </div>
    </div>
  );
}
