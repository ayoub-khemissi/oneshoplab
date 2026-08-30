import { toast } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, type RefObject } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { GenField } from './generate-button';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, type FieldState } from './state';
import type { ChatModelId, ImageQualityId } from '@/entities/ai-model';
import { sanitizeUserFacingError } from '@/lib/errors';
import { refreshKeepingScroll } from '@/lib/preserve-scroll';

interface UseGenerateSubmitArgs {
  siteId: string;
  productId: string;
  customInstructions: string;
  chatModelRef: RefObject<ChatModelId>;
  imageQualityRef: RefObject<ImageQualityId>;
  setFieldState: (field: GenField, next: FieldState) => void;
}

export function useGenerateSubmit({
  siteId,
  productId,
  customInstructions,
  chatModelRef,
  imageQualityRef,
  setFieldState
}: UseGenerateSubmitArgs): {
  submit: (field: GenField) => Promise<void>;
  cancel: (field: GenField) => void;
} {
  const router = useRouter();
  const t = useTranslations('Product');
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
            refreshKeepingScroll(() => router.refresh());
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
    [siteId, productId, customInstructions, chatModelRef, imageQualityRef, router, t, setFieldState]
  );

  return { submit, cancel };
}
