'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AddTile } from './ai-image-grid/add-tile';
import { ImageTile } from './ai-image-grid/image-tile';
import { NewImageModal } from './ai-image-grid/new-image-modal';
import { ReplacePicker } from './ai-image-grid/replace-picker';
import { useImageJobs } from './ai-image-grid/use-image-jobs';
import { saveProductImagePromptAction } from '../api/image-prompt-actions';
import { generationCount, MAX_IMAGES_PER_PRODUCT } from '../model/limits';
import type { ImageJobRow } from '@/entities/generation-job';

interface AiImageGridLiveProps {
  siteId: string;
  productId: string;
  /** Server-rendered initial state — avoids a flash of empty grid on
   *  first paint. Subsequent updates come from the polling endpoint. */
  initial: ImageJobRow[];
  /** Visible cost per image at the user's current quality setting.
   *  Drives the cost label on the Add and Regenerate buttons. */
  costPerImage: number;
  /** Price of a transparent-background cut-out (per image). */
  costRemoveBg: number;
  /** How long images stay in R2 before the cleanup worker removes
   *  them. Plan-specific (Free/Starter 30d, Pro 60d, Scale 90d) so the
   *  per-image expiry caption matches what the merchant has paid for. */
  retentionDays: number;
  /** This product's own image prompt, saved last time it was used. */
  savedPrompt?: string;
  /** Account-wide default output ratio; the modal starts there and can
   *  override it for a single image. */
  imageFormatId: string;
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
 *  - A dashed "+ add image" tile always closes the grid. Under the cap it
 *    opens the generation modal (preset angle or custom prompt); at the cap
 *    it asks which generation to replace and opens that modal in replace
 *    mode. Cut-outs never count toward the cap.
 *
 * State and mutations live in `./ai-image-grid/use-image-jobs`; the tiles
 * and the modal are the other modules of that folder.
 */
export function AiImageGridLive({
  siteId,
  productId,
  initial,
  costPerImage,
  costRemoveBg,
  retentionDays,
  savedPrompt = '',
  imageFormatId
}: AiImageGridLiveProps) {
  const t = useTranslations('AiImageGrid');
  const {
    rawJobs,
    now,
    busy,
    errorMsg,
    modalOpen,
    modalReplaceId,
    closeModal,
    deleteJob,
    openAddModal,
    openRegenerateModal,
    removeBackground,
    submitNewImage
  } = useImageJobs({ siteId, productId, initial });
  const atCap = generationCount(rawJobs) >= MAX_IMAGES_PER_PRODUCT;
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Only a modal reached through the picker offers a way back to it.
  const [fromPicker, setFromPicker] = useState(false);
  const replacing = modalReplaceId ? rawJobs.find((j) => j.id === modalReplaceId) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {rawJobs.map((job) => (
          <ImageTile
            key={job.id}
            job={job}
            now={now}
            costPerImage={costPerImage}
            costRemoveBg={costRemoveBg}
            retentionDays={retentionDays}
            isBusy={busy[job.id]}
            onDelete={() => deleteJob(job.id)}
            onRegenerate={() => openRegenerateModal(job.id)}
            onRemoveBg={() => removeBackground(job.id)}
          />
        ))}
        <AddTile
          costPerImage={costPerImage}
          onClick={() => (atCap ? setReplaceOpen(true) : openAddModal())}
        />
      </div>
      {rawJobs.length === 0 ? (
        <p className="text-sm text-[var(--muted)] italic">{t('emptyHint')}</p>
      ) : null}
      {errorMsg ? <p className="text-xs text-[var(--danger)]">{errorMsg}</p> : null}
      {replaceOpen ? (
        <ReplacePicker
          jobs={rawJobs}
          max={MAX_IMAGES_PER_PRODUCT}
          onCancel={() => setReplaceOpen(false)}
          onPick={(jobId) => {
            setReplaceOpen(false);
            setFromPicker(true);
            openRegenerateModal(jobId);
          }}
        />
      ) : null}
      {modalOpen ? (
        <NewImageModal
          costPerImage={costPerImage}
          costRemoveBg={costRemoveBg}
          isReplace={modalReplaceId !== null}
          replaceImageUrl={replacing?.imageUrl ?? null}
          onBack={
            fromPicker
              ? () => {
                  closeModal();
                  setFromPicker(false);
                  setReplaceOpen(true);
                }
              : undefined
          }
          initialCustomPrompt={savedPrompt}
          initialImageFormat={imageFormatId}
          onSavePrompt={(prompt) => {
            void saveProductImagePromptAction(productId, prompt);
          }}
          onCancel={() => {
            setFromPicker(false);
            closeModal();
          }}
          onSubmit={(payload) => submitNewImage({ ...payload, replaceJobId: modalReplaceId })}
        />
      ) : null}
    </div>
  );
}
