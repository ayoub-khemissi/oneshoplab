'use client';

import { createContext, useContext } from 'react';
import type { ChatModelId, ImageFormatId, ImageQualityId } from '@/entities/ai-model';
import type { GenField } from './generate-button';
import type { FieldState } from './state';

export interface ContextValue {
  states: Record<GenField, FieldState>;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  submit: (field: GenField) => void;
  cancel: (field: GenField) => void;
  // Live model selection — drives both the cost displayed on the buttons and
  // the chatModelId / imageQualityId sent to /api/products/generate.
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  /** Output ratio. Free of cost implications (kie prices per resolution,
   *  not per shape), so it only travels to the API — it never enters costFor. */
  imageFormatId: ImageFormatId;
  setChatModelId: (id: ChatModelId) => void;
  setImageQualityId: (id: ImageQualityId) => void;
  setImageFormatId: (id: ImageFormatId) => void;
  creditsBalance: number;
  costFor: (field: GenField) => number;
  canAfford: (field: GenField) => boolean;
  productArchived: boolean;
}

export const Ctx = createContext<ContextValue | null>(null);

export function useGenerateContext(): ContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('RetryableGenerateButton used outside its provider');
  return ctx;
}
