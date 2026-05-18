'use client';

import { useTransition } from 'react';
import type { ChatModelId, ImageQualityId } from '@/lib/ai/models';
import { updateUserPreferencesAction } from '@/lib/auth-actions';
import { ModelPickerChips } from './model-picker-chips';
import { useGenerateContext } from './retryable-generate';

/**
 * Product-page model/quality picker. Thin wrapper: state comes from the
 * generate context (so it drives the live per-button cost), the choice
 * is persisted account-wide via the existing server action, and the
 * chips themselves are the shared <ModelPickerChips> (same component
 * the bulk modal uses).
 */
export function ModelChips() {
  const { chatModelId, imageQualityId, setChatModelId, setImageQualityId } =
    useGenerateContext();
  const [, startPersist] = useTransition();

  function persist(next: {
    chatModelId?: ChatModelId;
    imageQualityId?: ImageQualityId;
  }) {
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

  return (
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
}
