'use client';

import { Skeleton, Spinner } from '@heroui/react';
import { Plus, RefreshCw, Trash2, X, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ImageExpiry } from '@/components/image-expiry';
import { ImageZoom } from '@/components/image-zoom';
import { MAX_IMAGES_PER_PRODUCT, type ImageJobRow } from '@/lib/ai/image-jobs-types';

interface AiImageGridLiveProps {
  siteId: string;
  productId: string;
  /** Server-rendered initial state — avoids a flash of empty grid on
   *  first paint. Subsequent updates come from the polling endpoint. */
  initial: ImageJobRow[];
  /** Visible cost per image at the user's current quality setting.
   *  Drives the cost label on the Add and Regenerate buttons. */
  costPerImage: number;
  /** How long images stay in R2 before the cleanup worker removes
   *  them. Plan-specific (Free/Starter 30d, Pro 60d, Scale 90d) so the
   *  per-image expiry caption matches what the merchant has paid for. */
  retentionDays: number;
}

/**
 * Live AI-images grid for the product page. Owns the full lifecycle:
 *
 *  - Server passes a snapshot of currently-visible image jobs as `initial`.
 *  - While any job is pending/running, we poll /api/products/image-jobs
 *    every ~2.5s and re-hydrate the grid from the response.
 *  - Each pending/running job renders as a HeroUI Skeleton with a live
 *    "elapsed Xs" caption (1-second tick).
 *  - Completed jobs render the image with delete + regenerate actions
 *    and an ImageExpiry caption (per-image, since each can have a
 *    different generation timestamp once regenerate is in play).
 *  - Failed jobs render a dismissible red tile with the kie error.
 *  - A dashed "+ add image" tile appears below as long as the visible
 *    count is < MAX_IMAGES_PER_PRODUCT. Clicking it opens a modal
 *    that lets the merchant pick a preset angle or write a custom prompt.
 */
export function AiImageGridLive({
  siteId,
  productId,
  initial,
  costPerImage,
  retentionDays
}: AiImageGridLiveProps) {
  const t = useTranslations('AiImageGrid');
  const router = useRouter();

  const [rawJobs, setJobs] = useState<ImageJobRow[]>(() =>
    initial.map(rehydrateDates)
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState<Record<string, 'delete' | 'regenerate'>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  // When set, the modal submits as a "regenerate this slot" instead of
  // a brand-new addition. The old job is hidden server-side as part of
  // the same POST so the grid stays at its current size.
  const [modalReplaceId, setModalReplaceId] = useState<string | null>(null);

  // 1-Hz tick: drives the elapsed-time captions on skeletons.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync from the server-provided `initial` whenever the parent
  // re-renders with a new snapshot — typically after `router.refresh()`
  // following a "Generate all" click on the same page. Without this,
  // useState's lazy initializer would lock the local state to whatever
  // shape the page mounted with, so the page would need a full reload
  // before a freshly-queued job appeared.
  //
  // The signature key keeps the dependency stable when the array
  // reference is new but content hasn't actually changed.
  const initialSignature = initial
    .map((j) => `${j.id}:${j.status}:${j.imageUrl ?? ''}`)
    .join('|');
  useEffect(() => {
    setJobs(initial.map(rehydrateDates));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSignature]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/products/image-jobs?siteId=${encodeURIComponent(siteId)}&productId=${encodeURIComponent(productId)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ImageJobRow[] };
      setJobs(data.jobs.map(rehydrateDates));
    } catch {
      // Ignore transient polling errors — the next tick will retry.
    }
  }, [siteId, productId]);

  // Poll while any job is non-terminal. We restart the timer whenever
  // the list shifts so a fresh kick (POST add) starts polling without
  // waiting for the next setInterval period to elapse.
  const hasActive = rawJobs.some(
    (j) => j.status === 'pending' || j.status === 'running'
  );
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      await refresh();
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasActive, refresh]);

  // Listen for an external "kick poll" event so a sibling component
  // (e.g. RetryableGenerateButton on the same page) can ask us to start
  // polling immediately when the merchant clicks "Generate all" — even
  // before any image jobs land in our local state. We don't need a
  // shared context: a CustomEvent on window keeps the components
  // decoupled.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ siteId?: string; productId?: string }>).detail;
      if (
        detail?.siteId !== siteId ||
        detail?.productId !== productId
      ) {
        return;
      }
      // Run several spaced refreshes — kie image jobs typically appear
      // in the DB within ~1s of the click; we want to pick them up
      // even if the chat-field call is still blocking the route.
      let count = 0;
      const id = setInterval(async () => {
        count += 1;
        await refresh();
        if (count >= 6) clearInterval(id);
      }, 800);
    };
    window.addEventListener('oneshoplab:kick-image-poll', handler);
    return () => {
      window.removeEventListener('oneshoplab:kick-image-poll', handler);
    };
  }, [siteId, productId, refresh]);

  async function deleteJob(jobId: string) {
    setBusy((b) => ({ ...b, [jobId]: 'delete' }));
    try {
      await fetch(
        `/api/products/image-jobs?siteId=${encodeURIComponent(siteId)}&productId=${encodeURIComponent(productId)}&jobId=${encodeURIComponent(jobId)}`,
        { method: 'DELETE' }
      );
      // Optimistic removal — the refresh below will reconcile against
      // the server's authoritative list.
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      await refresh();
      // Cancelling a pending/running job triggers a credit refund on
      // the server (via persistKieJobFailure idempotency); calling
      // router.refresh() re-runs the layout's auth() so the header
      // credit chip + the per-page balance pick up the new total
      // without a manual reload.
      router.refresh();
    } finally {
      setBusy((b) => {
        const { [jobId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  function openAddModal() {
    setModalReplaceId(null);
    setModalOpen(true);
  }

  function openRegenerateModal(jobId: string) {
    setModalReplaceId(jobId);
    setModalOpen(true);
  }

  async function submitNewImage(opts: {
    angle: 'lifestyle' | 'studio' | 'inuse' | 'custom';
    customPrompt: string;
    replaceJobId: string | null;
  }) {
    setErrorMsg(null);
    const res = await fetch('/api/products/image-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId,
        productId,
        angle: opts.angle,
        customPrompt: opts.customPrompt,
        replaceJobId: opts.replaceJobId
      })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setErrorMsg(t(errorKeyFromCode(body.error)));
      return false;
    }
    setModalOpen(false);
    await refresh();
    // Adding or regenerating an image debits credits — refresh the
    // page so the header chip + the per-page balance reflect the new
    // total. Same reason as the deleteJob path.
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {rawJobs.map((job) => (
          <ImageTile
            key={job.id}
            job={job}
            now={now}
            costPerImage={costPerImage}
            retentionDays={retentionDays}
            isBusy={busy[job.id]}
            onDelete={() => deleteJob(job.id)}
            onRegenerate={() => openRegenerateModal(job.id)}
          />
        ))}
        {rawJobs.length < MAX_IMAGES_PER_PRODUCT ? (
          <AddTile costPerImage={costPerImage} onClick={openAddModal} />
        ) : null}
      </div>
      {rawJobs.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic">{t('emptyHint')}</p>
      ) : null}
      {errorMsg ? (
        <p className="text-xs text-[var(--danger)]">{errorMsg}</p>
      ) : null}
      {modalOpen ? (
        <NewImageModal
          costPerImage={costPerImage}
          isReplace={modalReplaceId !== null}
          onCancel={() => setModalOpen(false)}
          onSubmit={(payload) =>
            submitNewImage({ ...payload, replaceJobId: modalReplaceId })
          }
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-job tile — switches presentation based on status.
// ---------------------------------------------------------------------------

function ImageTile({
  job,
  now,
  costPerImage,
  retentionDays,
  isBusy,
  onDelete,
  onRegenerate
}: {
  job: ImageJobRow;
  now: number;
  costPerImage: number;
  retentionDays: number;
  isBusy: 'delete' | 'regenerate' | undefined;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const t = useTranslations('AiImageGrid');
  // Confirmation guard for the destructive paths only (failed +
  // completed). Pending/running cancellations skip the dialog since
  // they're reversible (credits get refunded) and asking for
  // confirmation each time would be friction the merchant doesn't
  // need on an in-flight job.
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (job.status === 'pending' || job.status === 'running') {
    const startedAt = job.startedAt ?? job.createdAt;
    const elapsedSec = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
    // After ~90s the generation is taking longer than the kie average.
    // Surface a prominent cancel-and-refund affordance so the merchant
    // doesn't have to wait on the watchdog (which only kicks in at 8min).
    const showSlowBail = elapsedSec >= 90;
    return (
      <div className="aspect-square relative rounded-md overflow-hidden">
        <Skeleton className="absolute inset-0 rounded-md" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none p-3">
          <Spinner size="md" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
            {t('generatingElapsed', { seconds: elapsedSec })}
          </span>
          {showSlowBail ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isBusy === 'delete'}
              className="pointer-events-auto mt-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors disabled:opacity-50"
            >
              {isBusy === 'delete' ? t('cancellingShort') : t('cancelAndRefund')}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={isBusy === 'delete'}
          aria-label={t('cancel')}
          title={t('cancel')}
          className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
        >
          {isBusy === 'delete' ? (
            <Spinner size="sm" className="text-white" />
          ) : (
            <X className="size-3.5" />
          )}
        </button>
      </div>
    );
  }

  if (job.status === 'failed' || job.status === 'timed_out') {
    // The job-${id}-refund idempotency key guarantees the credits were
    // refunded exactly once (by whichever path got there first: the
    // synchronous catch in startImageOptim, the kie webhook, the watchdog
    // sweep, or the user's cancel-via-DELETE). We surface that fact here
    // so the merchant sees their balance is whole before deciding whether
    // to spend on a retry.
    return (
      <div className="aspect-square rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex flex-col items-center justify-center gap-1.5 p-3 text-center relative">
        <AlertTriangle className="size-5 text-[var(--danger)]" aria-hidden />
        <span className="text-xs font-medium text-[var(--danger)]">
          {t('failedLabel')}
        </span>
        <span className="text-[10px] text-[var(--success)] font-medium">
          {t('refundedNote', { cost: job.creditsCost })}
        </span>
        <button
          type="button"
          onClick={onRegenerate}
          className="text-[10px] uppercase tracking-wider text-[var(--accent)] hover:underline mt-1"
        >
          {t('retryWithCost', { cost: costPerImage })}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={isBusy === 'delete'}
          aria-label={t('delete')}
          title={t('delete')}
          className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
        >
          {isBusy === 'delete' ? (
            <Spinner size="sm" className="text-white" />
          ) : (
            <X className="size-3.5" />
          )}
        </button>
        <ConfirmDialog
          isOpen={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('confirmDeleteTitle')}
          description={t('confirmDeleteBody')}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          isPending={isBusy === 'delete'}
          onConfirm={onDelete}
        />
      </div>
    );
  }

  // completed
  const url = job.imageUrl;
  if (!url) {
    // Defensive: completed without a URL shouldn't happen; surface as an
    // error tile so the user can dismiss it.
    return (
      <div className="aspect-square rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-center p-3 text-center">
        <span className="text-xs text-[var(--danger)]">{t('failedLabel')}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group">
        <ImageZoom url={url} alt="Generated" downloadName={`ai-${job.id}.png`} />
        {/* Per-image action overlay: delete + regenerate, hover-revealed */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity z-10">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isBusy === 'regenerate'}
            aria-label={t('regenerateAria', { cost: costPerImage })}
            title={t('regenerateAria', { cost: costPerImage })}
            className="size-7 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
          >
            {isBusy === 'regenerate' ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isBusy === 'delete'}
            aria-label={t('delete')}
            title={t('delete')}
            className="size-7 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center text-white disabled:opacity-50"
          >
            {isBusy === 'delete' ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('confirmDeleteTitle')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        isPending={isBusy === 'delete'}
        onConfirm={onDelete}
      />
      <div className="flex justify-end">
        <ImageExpiry createdAt={job.createdAt} retentionDays={retentionDays} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add tile — dashed border + "+" + cost label.
// ---------------------------------------------------------------------------

function AddTile({
  costPerImage,
  onClick
}: {
  costPerImage: number;
  onClick: () => void;
}) {
  const t = useTranslations('AiImageGrid');
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square rounded-md border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--muted)] hover:text-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
    >
      <Plus className="size-6" aria-hidden />
      <span className="text-xs font-medium">{t('addImage')}</span>
      <span className="text-[10px] font-mono uppercase tracking-wider">
        {t('credits', { cost: costPerImage })}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal: pick an angle preset OR write a custom prompt, then submit.
// ---------------------------------------------------------------------------

function NewImageModal({
  costPerImage,
  isReplace,
  onCancel,
  onSubmit
}: {
  costPerImage: number;
  isReplace: boolean;
  onCancel: () => void;
  onSubmit: (payload: {
    angle: 'lifestyle' | 'studio' | 'inuse' | 'custom';
    customPrompt: string;
  }) => Promise<boolean>;
}) {
  const t = useTranslations('AiImageGrid');
  const [angle, setAngle] = useState<'lifestyle' | 'studio' | 'inuse' | 'custom'>(
    'lifestyle'
  );
  const [customPrompt, setCustomPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  async function handleSubmit() {
    if (submitting) return;
    if (angle === 'custom' && !customPrompt.trim()) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit({ angle, customPrompt: customPrompt.trim() });
      if (!ok) setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  }

  const angles: Array<{
    id: 'lifestyle' | 'studio' | 'inuse' | 'custom';
    label: string;
    description: string;
  }> = [
    {
      id: 'lifestyle',
      label: t('angleLifestyleTitle'),
      description: t('angleLifestyleHint')
    },
    {
      id: 'studio',
      label: t('angleStudioTitle'),
      description: t('angleStudioHint')
    },
    {
      id: 'inuse',
      label: t('angleInUseTitle'),
      description: t('angleInUseHint')
    },
    {
      id: 'custom',
      label: t('angleCustomTitle'),
      description: t('angleCustomHint')
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-2xl max-w-md w-full p-5 flex flex-col gap-4"
      >
        <div>
          <h3 className="text-base font-semibold">
            {isReplace ? t('regenerateTitle') : t('newImageTitle')}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-1">{t('modalSubtitle')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {angles.map((a) => (
            <label
              key={a.id}
              className={`p-3 rounded-md border cursor-pointer transition-colors flex items-start gap-3 ${
                angle === a.id
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] hover:border-[var(--muted)]'
              }`}
            >
              <input
                type="radio"
                name="angle"
                value={a.id}
                checked={angle === a.id}
                onChange={() => setAngle(a.id)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  {a.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        {angle === 'custom' ? (
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={t('customPromptPlaceholder')}
            maxLength={800}
            rows={3}
            className="w-full text-sm rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
            autoFocus
          />
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted)] font-mono uppercase tracking-wider">
            {t('credits', { cost: costPerImage })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 rounded-md text-sm hover:bg-[var(--default)]"
            >
              {t('cancelModal')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                submitting || (angle === 'custom' && !customPrompt.trim())
              }
              className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting ? <Spinner size="sm" /> : null}
              {isReplace ? t('confirmRegenerate') : t('confirmAdd')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a server error code to the matching translation key. Falls back
 *  to a generic message when the code isn't one we explicitly handle. */
function errorKeyFromCode(code: string | undefined): string {
  switch (code) {
    case 'insufficient_credits':
      return 'errorInsufficientCredits';
    case 'no_source_image':
      return 'errorNoSourceImage';
    case 'image_cap_reached':
      return 'errorCapReached';
    default:
      return 'errorGeneric';
  }
}

/** JSON.parse strips Date objects to strings — restore them for any
 *  field the UI does math on. */
function rehydrateDates(j: ImageJobRow): ImageJobRow {
  return {
    ...j,
    createdAt: new Date(j.createdAt),
    startedAt: j.startedAt ? new Date(j.startedAt) : null,
    finishedAt: j.finishedAt ? new Date(j.finishedAt) : null
  };
}
