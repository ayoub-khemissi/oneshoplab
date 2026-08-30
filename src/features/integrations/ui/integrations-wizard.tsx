'use client';

import { Card } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { COMING_SOON } from '../lib/guide-steps';
import type {
  ConnectionStatus,
  IntegrationInterestMap,
  IntegrationPlatform,
  KeyActionResult,
  SiteKeySummary
} from '../model/types';
import { ConnectionStatusCard } from './connection-status-card';
import { KeyManagement } from './key-management';
import { PlatformGuide } from './platform-guide';
import { PlatformPicker, platformName } from './platform-picker';
import { KeyReveal, SiteKeyStep } from './site-key-step';
import { setPlatformAction } from '../api/actions';

/**
 * Spec §9: choose platform → numbered guide → site key (created here, shown
 * once) → live connection check → key management. State stays client-side so
 * the freshly created plaintext survives until the merchant confirms it.
 */
export function IntegrationsWizard({
  projectId,
  detectedPlatform,
  initialKeys,
  initialStatus,
  interest
}: {
  projectId: string;
  detectedPlatform: IntegrationPlatform | null;
  initialKeys: SiteKeySummary[];
  initialStatus: ConnectionStatus;
  interest: IntegrationInterestMap;
}) {
  const t = useTranslations('Integrations');
  const [platform, setPlatform] = useState<IntegrationPlatform | null>(detectedPlatform);
  const [keys, setKeys] = useState(initialKeys);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rotatedPlaintext, setRotatedPlaintext] = useState<string | null>(null);

  const usable = keys.filter((k) => k.state === 'active' || k.state === 'grace');
  const activeKey = usable.find((k) => k.state === 'active') ?? usable[0] ?? null;
  const keyStepAvailable = platform !== null && !COMING_SOON[platform];

  function choosePlatform(next: IntegrationPlatform) {
    setPlatform(next);
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('platform', next);
    void setPlatformAction(fd);
  }

  function onCreated(res: Extract<KeyActionResult, { ok: true }>) {
    setKeys((prev) => [...prev, res.key]);
    setRevealed(res.plaintext);
  }

  function onRotated(res: Extract<KeyActionResult, { ok: true }>, oldKeyId: string) {
    setKeys((prev) => [
      ...prev.map((k) => (k.id === oldKeyId ? { ...k, state: 'grace' as const } : k)),
      res.key
    ]);
    setRotatedPlaintext(res.plaintext);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card variant="secondary" className="p-5 flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t('wizardTitle')}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed max-w-2xl">{t('wizardIntro')}</p>
      </Card>

      <Step n={1} title={t('step1Title')} hint={t('step1Hint')}>
        <PlatformPicker value={platform} detected={detectedPlatform} onChange={choosePlatform} />
      </Step>

      <Step n={2} title={t('step2Title')}>
        <PlatformGuide
          projectId={projectId}
          platform={platform}
          siteKeyPlaintext={revealed}
          interest={interest}
        />
      </Step>

      <Step n={3} title={t('step3Title')}>
        {keyStepAvailable ? (
          <SiteKeyStep
            projectId={projectId}
            activeKey={activeKey}
            revealed={revealed}
            onCreated={onCreated}
            onSaved={() => setRevealed(null)}
          />
        ) : (
          <p className="text-sm text-[var(--muted)] italic">
            {platform
              ? t('step3NotAvailable', { platform: platformName(platform) })
              : t('chooseFirst')}
          </p>
        )}
      </Step>

      {activeKey ? (
        <Step n={4} title={t('step4Title')}>
          <ConnectionStatusCard projectId={projectId} initial={initialStatus} />
        </Step>
      ) : null}

      {keys.length > 0 ? (
        <Card variant="secondary" className="p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t('keysTitle')}</h3>
          {rotatedPlaintext ? (
            <KeyReveal plaintext={rotatedPlaintext} onSaved={() => setRotatedPlaintext(null)} />
          ) : null}
          <KeyManagement
            projectId={projectId}
            keys={keys}
            onRotated={onRotated}
            onRevoked={(id) =>
              setKeys((prev) =>
                prev.map((k) => (k.id === id ? { ...k, state: 'revoked' as const } : k))
              )
            }
          />
        </Card>
      ) : null}
    </div>
  );
}

function Step({
  n,
  title,
  hint,
  children
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card variant="secondary" className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="size-7 rounded-full border border-[var(--accent)] text-[var(--accent)] text-sm font-semibold inline-flex items-center justify-center shrink-0">
          {n}
        </span>
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}
