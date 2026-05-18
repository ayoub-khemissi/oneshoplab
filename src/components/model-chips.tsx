'use client';

import { Coins } from 'lucide-react';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  CHAT_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  costForImage,
  estimateChatCredits,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai/models';
import { updateUserPreferencesAction } from '@/lib/auth-actions';
import { useGenerateContext } from './retryable-generate';

/**
 * Compact picker that sits above the AI suggestions card on the product
 * optimisation page. Each row of chips lets the merchant flip the model
 * being used for chat-based fields (title / description / tags) and the
 * image quality used for the image regenerations. The selection drives the
 * live cost displayed on every "Generate" button via RetryableGenerateProvider,
 * and is persisted to the user preferences via the existing server action so
 * the choice survives a reload.
 */
export function ModelChips() {
  const t = useTranslations('Product');
  const {
    chatModelId,
    imageQualityId,
    setChatModelId,
    setImageQualityId
  } = useGenerateContext();
  const [, startPersist] = useTransition();

  // Image model + provider are constant across resolutions today; pick
  // them off the first registry entry so the row label can attribute
  // GPT-Image 2 / OpenAI without repeating it on every chip.
  const firstImage = Object.values(IMAGE_MODEL_REGISTRY)[0];
  const imageModelName = firstImage.modelName;
  const imageModelProvider = firstImage.provider;

  function persist(next: { chatModelId?: ChatModelId; imageQualityId?: ImageQualityId }) {
    const fd = new FormData();
    fd.set('chatModel', next.chatModelId ?? chatModelId);
    fd.set('imageQuality', next.imageQualityId ?? imageQualityId);
    startPersist(() => {
      updateUserPreferencesAction(fd).catch(() => {
        // Persist failure is non-blocking — local state already updated and
        // the in-flight generation call still gets the live override via
        // the request body. The next reload will pick up the older value.
      });
    });
  }

  function pickChat(id: ChatModelId) {
    if (id === chatModelId) return;
    setChatModelId(id);
    persist({ chatModelId: id });
  }

  function pickImage(id: ImageQualityId) {
    if (id === imageQualityId) return;
    setImageQualityId(id);
    persist({ imageQualityId: id });
  }

  return (
    <div className="flex flex-col gap-3">
      <ChipsRow label={t('chatModelLabel')}>
        {(Object.values(CHAT_MODEL_REGISTRY) as Array<
          (typeof CHAT_MODEL_REGISTRY)[ChatModelId]
        >).map((m) => (
          <Chip
            key={m.id}
            active={m.id === chatModelId}
            label={m.displayName}
            sublabel={m.provider}
            cost={`~${estimateChatCredits(m.id, 'fullAudit')}`}
            tier={m.tier}
            onClick={() => pickChat(m.id)}
          />
        ))}
      </ChipsRow>

      <ChipsRow
        label={t('imageQualityLabel')}
        // The whole image row uses one model (GPT-Image 2 by OpenAI), so
        // the attribution sits next to the row label instead of being
        // repeated on every chip.
        sublabel={`${imageModelName} · ${imageModelProvider}`}
      >
        {(Object.values(IMAGE_MODEL_REGISTRY) as Array<
          (typeof IMAGE_MODEL_REGISTRY)[ImageQualityId]
        >).map((m) => (
          <Chip
            key={m.id}
            active={m.id === imageQualityId}
            label={m.displayName}
            cost={`${costForImage(m.id)}`}
            tier={m.tier}
            onClick={() => pickImage(m.id)}
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
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="flex flex-col shrink-0">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          {label}
        </span>
        {sublabel ? (
          <span className="text-[10px] font-mono text-[var(--muted)]/80">
            {sublabel}
          </span>
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
  const activeCls =
    'bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]';
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
