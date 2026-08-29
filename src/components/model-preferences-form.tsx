'use client';

import { Card, Spinner } from '@heroui/react';
import { Check } from 'lucide-react';
import { useState, useTransition } from 'react';
// Import from the leaf module (no server-only deps) so this client bundle
// stays free of mysql2 / drizzle imports leaking through the @/lib/ai barrel.
import {
  CHAT_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  costForImage,
  estimateChatCredits,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai/models';
import { updateUserPreferencesAction } from '@/lib/auth-actions';
import { useModelCopy } from './use-model-copy';

interface ModelPreferencesFormProps {
  initialChatModel: ChatModelId;
  initialImageQuality: ImageQualityId;
  /** UI strings (translated by the parent server component). */
  copy: {
    chatLabel: string;
    chatHint: string;
    imageLabel: string;
    imageHint: string;
    saveButton: string;
    saved: string;
    perGen: string;
    perImage: string;
  };
}

/**
 * Account-wide preferences form. Submits via server action and shows a brief
 * "Saved" confirmation. The selected models apply to ALL future generations
 * across the user's projects.
 */
export function ModelPreferencesForm({
  initialChatModel,
  initialImageQuality,
  copy
}: ModelPreferencesFormProps) {
  const modelCopy = useModelCopy();
  const [chatModel, setChatModel] = useState<ChatModelId>(initialChatModel);
  const [imageQuality, setImageQuality] = useState<ImageQualityId>(initialImageQuality);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    chatModel !== initialChatModel || imageQuality !== initialImageQuality;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await updateUserPreferencesAction(formData);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-6">
      <Card variant="secondary" className="p-5 flex flex-col gap-3">
        <label
          htmlFor="chatModel"
          className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
        >
          {copy.chatLabel}
        </label>
        <div className="grid gap-2">
          {(Object.values(CHAT_MODEL_REGISTRY) as Array<
            (typeof CHAT_MODEL_REGISTRY)[ChatModelId]
          >).map((m) => {
            const cost = estimateChatCredits(m.id, 'fullAudit');
            const active = chatModel === m.id;
            return (
              <ModelOptionCard
                key={m.id}
                active={active}
                title={m.displayName}
                provider={m.provider}
                tier={m.tier}
                tierLabel={modelCopy.tierLabel(m.tier)}
                tagline={modelCopy.chatTagline(m.id, m.tagline)}
                costLabel={`~${cost} ${copy.perGen}`}
                onSelect={() => setChatModel(m.id)}
              />
            );
          })}
        </div>
        <input type="hidden" name="chatModel" value={chatModel} />
        <p className="text-xs text-[var(--muted)]">{copy.chatHint}</p>
      </Card>

      <Card variant="secondary" className="p-5 flex flex-col gap-3">
        <label
          htmlFor="imageQuality"
          className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
        >
          {copy.imageLabel}
        </label>
        <div className="grid gap-2">
          {(Object.values(IMAGE_MODEL_REGISTRY) as Array<
            (typeof IMAGE_MODEL_REGISTRY)[ImageQualityId]
          >).map((m) => {
            const cost = costForImage(m.id);
            const active = imageQuality === m.id;
            return (
              <ModelOptionCard
                key={m.id}
                active={active}
                title={`${m.modelName} · ${modelCopy.qualityLabel(m.id, m.resolution, m.displayName)}`}
                provider={m.provider}
                tier={m.tier}
                tierLabel={modelCopy.tierLabel(m.tier)}
                tagline={modelCopy.qualityTagline(m.id, m.tagline)}
                costLabel={`${cost} ${copy.perImage}`}
                onSelect={() => setImageQuality(m.id)}
              />
            );
          })}
        </div>
        <input type="hidden" name="imageQuality" value={imageQuality} />
        <p className="text-xs text-[var(--muted)]">{copy.imageHint}</p>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {savedAt ? (
          <span className="text-xs text-[var(--success)] font-medium inline-flex items-center gap-1.5">
            <Check className="size-3.5" /> {copy.saved}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={!dirty || isPending}
          className="px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? <Spinner size="sm" /> : copy.saveButton}
        </button>
      </div>
    </form>
  );
}

function ModelOptionCard({
  active,
  title,
  provider,
  tier,
  tierLabel,
  tagline,
  costLabel,
  onSelect
}: {
  active: boolean;
  title: string;
  provider: string;
  tier: 'budget' | 'balanced' | 'premium';
  /** Localised badge text; `tier` itself only drives the colour. */
  tierLabel: string;
  tagline: string;
  costLabel: string;
  onSelect: () => void;
}) {
  const tierColors: Record<typeof tier, string> = {
    budget: 'bg-[var(--success)]/10 text-[var(--success)]',
    balanced: 'bg-[var(--accent)]/10 text-[var(--accent)]',
    premium: 'bg-[var(--warning)]/10 text-[var(--warning)]'
  };
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-md border p-3 flex items-start justify-between gap-3 transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
          : 'border-[var(--border)] hover:border-[var(--accent)]/60 bg-[var(--background)]'
      }`}
      aria-pressed={active}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{title}</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-mono">
            {provider}
          </span>
          <span
            className={`text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded ${tierColors[tier]}`}
          >
            {tierLabel}
          </span>
        </div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{tagline}</p>
      </div>
      <span className="text-xs font-mono text-[var(--muted)] whitespace-nowrap shrink-0 mt-0.5">
        {costLabel}
      </span>
    </button>
  );
}

