import { createContext, useContext } from 'react';
import type { ChatModelId, ImageQualityId } from '@/lib/ai/models';
import type { GenField } from '@/components/generate-button';
import type { FieldState } from '@/components/retryable-generate/state';

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
  setChatModelId: (id: ChatModelId) => void;
  setImageQualityId: (id: ImageQualityId) => void;
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
