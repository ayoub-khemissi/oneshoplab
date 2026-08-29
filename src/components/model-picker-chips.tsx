'use client';

import { Coins } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useModelCopy } from './use-model-copy';
import type { ReactNode } from 'react';
import {
  CHAT_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  costForImage,
  estimateChatCredits,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai/models';

/**
 * Presentational model/quality chip picker. Pure — no state, no
 * persistence; the caller owns those. Shared by the product page
 * (<ModelChips>, wired to the generate context + account persist) and
 * the bulk modal (local state + account persist), so both look and
 * behave identically.
 */
export function ModelPickerChips({
  chatModelId,
  imageQualityId,
  onPickChat,
  onPickImage
}: {
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
  onPickChat: (id: ChatModelId) => void;
  onPickImage: (id: ImageQualityId) => void;
}) {
  const t = useTranslations('Product');
  const modelCopy = useModelCopy();
  const firstImage = Object.values(IMAGE_MODEL_REGISTRY)[0];
  const imageModelName = firstImage.modelName;
  const imageModelProvider = firstImage.provider;

  return (
    <div className="flex flex-col gap-3">
      <ChipsRow label={t('chatModelLabel')}>
        {(
          Object.values(CHAT_MODEL_REGISTRY) as Array<(typeof CHAT_MODEL_REGISTRY)[ChatModelId]>
        ).map((m) => (
          <Chip
            key={m.id}
            active={m.id === chatModelId}
            label={m.displayName}
            sublabel={m.provider}
            cost={`~${estimateChatCredits(m.id, 'fullAudit')}`}
            tier={m.tier}
            onClick={() => {
              if (m.id !== chatModelId) onPickChat(m.id);
            }}
          />
        ))}
      </ChipsRow>

      <ChipsRow
        label={t('imageQualityLabel')}
        sublabel={`${imageModelName} · ${imageModelProvider}`}
      >
        {(
          Object.values(IMAGE_MODEL_REGISTRY) as Array<
            (typeof IMAGE_MODEL_REGISTRY)[ImageQualityId]
          >
        ).map((m) => (
          <Chip
            key={m.id}
            active={m.id === imageQualityId}
            label={modelCopy.qualityLabel(m.id, m.resolution, m.displayName)}
            cost={`${costForImage(m.id)}`}
            tier={m.tier}
            onClick={() => {
              if (m.id !== imageQualityId) onPickImage(m.id);
            }}
          />
        ))}
      </ChipsRow>
    </div>
  );
}

function ChipsRow({
  label,
  sublabel,
  children
}: {
  label: string;
  sublabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="flex flex-col shrink-0">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          {label}
        </span>
        {sublabel ? (
          <span className="text-[10px] font-mono text-[var(--muted)]/80">{sublabel}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

const TIER_COLORS: Record<'budget' | 'balanced' | 'premium', string> = {
  budget: 'bg-[var(--success)]/10 text-[var(--success)]',
  balanced: 'bg-[var(--accent)]/10 text-[var(--accent)]',
  premium: 'bg-[var(--warning)]/10 text-[var(--warning)]'
};

function Chip({
  active,
  label,
  sublabel,
  cost,
  tier,
  onClick
}: {
  active: boolean;
  label: string;
  sublabel?: string;
  cost: string;
  tier: 'budget' | 'balanced' | 'premium';
  onClick: () => void;
}) {
  const base =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border';
  const activeCls = 'bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]';
  const idleCls =
    'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeCls : idleCls}`}
      title={sublabel ? `${label} · ${sublabel}` : undefined}
    >
      <span className="inline-flex items-center gap-1">
        <span>{label}</span>
        {sublabel ? (
          <span className={`text-[10px] ${active ? 'opacity-80' : 'text-[var(--muted)]'}`}>
            · {sublabel}
          </span>
        ) : null}
      </span>
      <span
        className={`text-[10px] font-mono px-1 rounded inline-flex items-center gap-0.5 ${
          active ? 'bg-white/20 text-current' : TIER_COLORS[tier]
        }`}
      >
        <Coins className="size-2.5" aria-hidden />
        {cost}
      </span>
    </button>
  );
}
