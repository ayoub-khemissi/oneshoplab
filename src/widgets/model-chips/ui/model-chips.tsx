'use client';

import { Modal } from '@heroui/react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import {
  CHAT_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import { updateUserPreferencesAction } from '@/features/model-preferences';
import { ModelPickerChips, useModelCopy } from '@/features/model-preferences';
import { useGenerateContext } from '@/features/retryable-generate';
import { ModalCloseButton } from '@/shared/ui';

/**
 * Product-page model/quality picker. State comes from the generate context (so
 * it drives the live per-button cost), the choice is persisted account-wide via
 * the existing server action, and the chips themselves are the shared
 * <ModelPickerChips> (same component the bulk modal uses).
 *
 * Collapsed to one line by default. Six chips sat permanently above the fold
 * for a choice a merchant makes about once a month, pushing the product's own
 * fields down a phone screen; the picker is one tap away instead.
 */
export function ModelChips() {
  const t = useTranslations('Product');
  const modelCopy = useModelCopy();
  const { chatModelId, imageQualityId, setChatModelId, setImageQualityId } = useGenerateContext();
  const [open, setOpen] = useState(false);
  const [, startPersist] = useTransition();

  function persist(next: { chatModelId?: ChatModelId; imageQualityId?: ImageQualityId }) {
    const fd = new FormData();
    fd.set('chatModel', next.chatModelId ?? chatModelId);
    fd.set('imageQuality', next.imageQualityId ?? imageQualityId);
    startPersist(() => {
      // Non-blocking: local state already updated and the in-flight
      // generation call still gets the live override via the request
      // body. A reload would otherwise pick up the older value.
      updateUserPreferencesAction(fd).catch(() => {});
    });
  }

  const picker = (
    <ModelPickerChips
      chatModelId={chatModelId}
      imageQualityId={imageQualityId}
      onPickChat={(id) => {
        setChatModelId(id);
        persist({ chatModelId: id });
      }}
      onPickImage={(id) => {
        setImageQualityId(id);
        persist({ imageQualityId: id });
      }}
    />
  );

  const chatName = CHAT_MODEL_REGISTRY[chatModelId].displayName;
  const image = IMAGE_MODEL_REGISTRY[imageQualityId];
  const imageName = modelCopy.qualityLabel(image.id, image.resolution, image.displayName);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
      <span data-testid="models-summary" className="truncate">
        {t('modelsSummary', { chat: chatName, image: imageName })}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="models-open"
        className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline underline-offset-2"
      >
        <SlidersHorizontal className="size-3" aria-hidden />
        {t('modelsChange')}
      </button>

      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <ModalCloseButton onClose={() => setOpen(false)} />
              <Modal.Header className="pr-10">
                <Modal.Heading className="text-base font-semibold">
                  {t('modelsModalTitle')}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>{picker}</Modal.Body>
              <Modal.Footer className="justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
                >
                  {t('modelsModalClose')}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
