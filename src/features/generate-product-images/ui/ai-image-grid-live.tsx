'use client';

import { useTranslations } from 'next-intl';
import { AddTile } from './ai-image-grid/add-tile';
import { ImageTile } from './ai-image-grid/image-tile';
import { NewImageModal } from './ai-image-grid/new-image-modal';
import { useImageJobs } from './ai-image-grid/use-image-jobs';
import { MAX_IMAGES_PER_PRODUCT } from '../model/limits';
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
 *
 * State and mutations live in `./ai-image-grid/use-image-jobs`; the tiles
 * and the modal are the other modules of that folder.
 */
export function AiImageGridLive({
  siteId,
  productId,
  initial,
  costPerImage,
  retentionDays
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
    submitNewImage
  } = useImageJobs({ siteId, productId, initial });

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
      {errorMsg ? <p className="text-xs text-[var(--danger)]">{errorMsg}</p> : null}
      {modalOpen ? (
        <NewImageModal
          costPerImage={costPerImage}
          isReplace={modalReplaceId !== null}
          onCancel={closeModal}
          onSubmit={(payload) => submitNewImage({ ...payload, replaceJobId: modalReplaceId })}
        />
      ) : null}
    </div>
  );
}
