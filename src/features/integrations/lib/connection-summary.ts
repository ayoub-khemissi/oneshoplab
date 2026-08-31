import type { ShopifyConnectionView } from '@/entities/shop-connection/client';
import type { IntegrationPlatform, SiteKeySummary } from '../model/types';

/**
 * What the merchant should read in one second at the top of the tab: is my
 * store plugged in, and if not, what is missing. Pure so the whole truth table
 * is unit-tested — the card below it only paints the answer.
 */
export interface ConnectionSummaryInput {
  platform: IntegrationPlatform | null;
  /** The platform is known but we don't support connecting it yet. */
  comingSoon: boolean;
  keys: SiteKeySummary[];
  /** Last call from the plugin (site-key path), ISO. */
  lastUsedAtIso: string | null;
  /** Products OneShopLab holds for this store. */
  productCount: number;
  connection: ShopifyConnectionView | null;
}

export type SummaryTone = 'ok' | 'warn' | 'danger' | 'idle';

export type SummaryStepKey = 'platform' | 'credential' | 'sync';

export interface SummaryStep {
  key: SummaryStepKey;
  done: boolean;
}

export interface ConnectionSummaryView {
  tone: SummaryTone;
  /** Drives the headline + the sentence under it (i18n keys). */
  state: 'connected' | 'attention' | 'partial' | 'idle';
  steps: SummaryStep[];
  /** The step to act on now — null once everything is done. */
  next: SummaryStepKey | null;
  /** Set when something that used to work is broken (i18n key suffix). */
  problem: 'tokenInvalid' | 'connectionRevoked' | 'keysDead' | 'keyGraceOnly' | null;
}

/** An app-based platform connects through OAuth, not through a site key. */
function usesApp(platform: IntegrationPlatform | null): boolean {
  return platform === 'shopify' || platform === 'wix';
}

export function summarizeConnection(input: ConnectionSummaryInput): ConnectionSummaryView {
  const { platform, comingSoon, keys, lastUsedAtIso, productCount, connection } = input;

  const platformDone = platform !== null && !comingSoon;
  const liveKeys = keys.filter((k) => k.state === 'active' || k.state === 'grace');
  const hadKeys = keys.length > 0;
  const appPath = usesApp(platform);

  const credentialDone = appPath ? connection?.status === 'connected' : liveKeys.length > 0;
  // "Synced" means the store actually talked to us AND we hold its catalog —
  // a key that was never called, or a pull that returned nothing, is not a
  // connection the merchant can use.
  const syncDone =
    credentialDone &&
    productCount > 0 &&
    (appPath ? connection?.lastPullAtIso != null : lastUsedAtIso != null);

  const problem: ConnectionSummaryView['problem'] =
    connection?.status === 'token_invalid'
      ? 'tokenInvalid'
      : connection?.status === 'revoked'
        ? 'connectionRevoked'
        : !appPath && hadKeys && liveKeys.length === 0
          ? 'keysDead'
          : !appPath && liveKeys.length > 0 && liveKeys.every((k) => k.state === 'grace')
            ? 'keyGraceOnly'
            : null;

  const steps: SummaryStep[] = [
    { key: 'platform', done: platformDone },
    { key: 'credential', done: credentialDone },
    { key: 'sync', done: syncDone }
  ];
  const next = steps.find((s) => !s.done)?.key ?? null;

  // A broken credential outranks everything: the merchant has work to do on a
  // store that used to be plugged in.
  if (problem === 'tokenInvalid' || problem === 'connectionRevoked' || problem === 'keysDead') {
    return { tone: 'danger', state: 'attention', steps, next: 'credential', problem };
  }
  if (syncDone) {
    return {
      tone: problem === 'keyGraceOnly' ? 'warn' : 'ok',
      state: 'connected',
      steps,
      next: null,
      problem
    };
  }
  if (!platformDone && !credentialDone) {
    return { tone: 'idle', state: 'idle', steps, next, problem };
  }
  return { tone: 'warn', state: 'partial', steps, next, problem };
}
