'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GenField } from '@/components/generate-button';
import { Ctx, type ContextValue } from '@/components/retryable-generate/context';
import {
  IDLE_STATES,
  IMAGE_ANGLES_PER_GEN,
  type FieldState
} from '@/components/retryable-generate/state';
import { useGenerateSubmit } from '@/components/retryable-generate/use-generate-submit';
import { useRecentFailedChatJobToasts } from '@/components/retryable-generate/use-recent-failed-toasts';
import { useResumedChatJobsPoll } from '@/components/retryable-generate/use-resumed-chat-jobs';
import {
  costForImage,
  estimateChatCredits,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai/models';

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

  useResumedChatJobsPoll(productId, inFlightChatJobs);
  useRecentFailedChatJobToasts(recentFailedChatJobs);

  const [customInstructions, setCustomInstructions] = useState(initialCustomInstructions);
  const [chatModelId, setChatModelId] = useState<ChatModelId>(initialChatModelId);
  const [imageQualityId, setImageQualityId] = useState<ImageQualityId>(initialImageQualityId);

  // Refs so submit() always reads the latest selection without re-creating
  // the callback (which would also re-create every memoized child).
  const chatModelRef = useRef(chatModelId);
  const imageQualityRef = useRef(imageQualityId);
  useEffect(() => {
    chatModelRef.current = chatModelId;
  }, [chatModelId]);
  useEffect(() => {
    imageQualityRef.current = imageQualityId;
  }, [imageQualityId]);

  const costFor = useCallback(
    (field: GenField): number => {
      const cm = chatModelId;
      const iq = imageQualityId;
      const t = estimateChatCredits(cm, 'title');
      const d = estimateChatCredits(cm, 'description');
      const tg = estimateChatCredits(cm, 'tags');
      const img = costForImage(iq) * IMAGE_ANGLES_PER_GEN;
      switch (field) {
        case 'title':
          return t;
        case 'description':
          return d;
        case 'tags':
          return tg;
        case 'images':
          return img;
        case 'all':
          return t + d + tg + img;
      }
    },
    [chatModelId, imageQualityId]
  );

  const canAfford = useCallback(
    (field: GenField) => creditsBalance >= costFor(field),
    [creditsBalance, costFor]
  );

  const { submit, cancel } = useGenerateSubmit({
    siteId,
    productId,
    customInstructions,
    chatModelRef,
    imageQualityRef,
    setFieldState
  });

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
