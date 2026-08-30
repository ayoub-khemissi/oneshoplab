/**
 * Every integration email renders in every locale without a leftover
 * `{placeholder}` — the i18n checker cannot see these runtime-built keys.
 */
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_EMAIL_KINDS,
  buildIntegrationEmail,
  type SyncFailureReason
} from '@/entities/notification/lib/integration-email';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const base = {
  recipientName: 'Ada',
  siteName: 'Atelier',
  integrationsUrl: 'http://localhost:3030/en/dashboard/sites/p1?tab=integrations',
  params: { keyName: 'plugin', days: 7, expiresAt: new Date('2026-09-06T00:00:00Z'), limit: 500 }
};
const REASONS: SyncFailureReason[] = ['plan_limit', 'unreachable', 'token_invalid', 'unknown'];

describe('buildIntegrationEmail', () => {
  it('renders every kind in all locales with no placeholder left', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const kind of INTEGRATION_EMAIL_KINDS) {
        for (const reason of kind === 'integration_sync_failed' ? REASONS : ['unknown' as const]) {
          const m = await buildIntegrationEmail({
            ...base,
            locale,
            kind,
            params: { ...base.params, reason, error: 'boom' }
          });
          for (const s of [m.subject, m.text, m.html]) {
            expect(s, `${locale}/${kind}/${reason}`).not.toMatch(/[{}]/);
            expect(s).toContain('Atelier');
          }
          expect(m.text).toContain(base.integrationsUrl);
        }
      }
    }
  });

  it('EN and FR copy', async () => {
    const en = await buildIntegrationEmail({
      ...base,
      locale: 'en',
      kind: 'integration_key_expiring'
    });
    expect(en.subject).toBe('Your API key “plugin” expires in 7 days (Atelier)');
    expect(en.text).toContain('September 6, 2026');
    const fr = await buildIntegrationEmail({
      ...base,
      locale: 'fr',
      kind: 'integration_sync_failed',
      params: { reason: 'plan_limit', limit: 500 }
    });
    expect(fr.subject).toBe('Synchronisation échouée pour Atelier');
    expect(fr.text).toContain('500 produits');
  });

  it('falls back to English for an unknown locale and anonymous recipient', async () => {
    const m = await buildIntegrationEmail({
      ...base,
      locale: 'xx',
      recipientName: null,
      kind: 'integration_token_invalid'
    });
    expect(m.text.startsWith('Hello,')).toBe(true);
    expect(m.text).toContain('3. Done');
  });
});
