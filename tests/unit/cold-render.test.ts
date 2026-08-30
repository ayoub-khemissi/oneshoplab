/**
 * Cold-email rendering: every variant × language renders with all
 * placeholders substituted, carries the opt-out link, and — product
 * decision — never instructs the reader to reply "STOP" (link only).
 */
import { describe, expect, it } from 'vitest';
import {
  getTemplate,
  platformDisplayName,
  renderColdMail,
  type ColdVars
} from '@/features/cold-outreach';

const OPT_OUT = 'https://oneshoplab.com/fr/unsubscribe?e=abc';
const agencyVars: ColdVars = {
  firstName: 'Marie',
  agencyName: 'Studio Nova',
  auditUrl: 'https://oneshoplab.com/fr/audit',
  discordUrl: 'https://discord.gg/x',
  optOutUrl: OPT_OUT,
  fromName: 'Ayoub'
};
const merchantVars: ColdVars = {
  firstName: 'Paul',
  storeName: 'Maison Bleue',
  platformDisplay: 'Shopify',
  auditUrl: 'https://oneshoplab.com/fr/audit/tok',
  discordUrl: 'https://discord.gg/x',
  optOutUrl: OPT_OUT,
  fromName: 'Ayoub',
  scoreOverall: '67',
  productsAudited: '48',
  productsNoImage: '3',
  productsNoDesc: '11',
  productsNoTags: '20'
};
const cases = [
  ['agency', 'fr', agencyVars],
  ['agency', 'en', agencyVars],
  ['merchant_audited', 'fr', merchantVars],
  ['merchant_audited', 'en', merchantVars],
  ['merchant_unaudited', 'fr', merchantVars],
  ['merchant_unaudited', 'en', merchantVars]
] as const;

describe('renderColdMail', () => {
  it.each(cases)(
    '%s / %s: substituted, opt-out link, no STOP instruction',
    (variant, lang, vars) => {
      const m = renderColdMail(variant, lang, 1, vars);
      expect(m.subject.trim().length).toBeGreaterThan(5);
      for (const part of [m.subject, m.text, m.html]) {
        expect(part).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(part).not.toMatch(/\bSTOP\b/i);
      }
      expect(m.text).toContain(OPT_OUT);
      expect(m.html).toContain(OPT_OUT);
      expect(m.text).toContain(vars.firstName);
      expect(m.html).toContain('<');
    }
  );

  it('merchant_audited uses the audit numbers as the hook', () => {
    const m = renderColdMail('merchant_audited', 'fr', 1, merchantVars);
    expect(m.subject).toContain('67');
    expect(m.text).toContain('Maison Bleue');
    expect(m.text).toContain('Shopify');
  });

  it('templates exist for every variant × language', () => {
    for (const [variant, lang] of cases) {
      const t = getTemplate(variant, lang, 1);
      expect(t.subject).toBeTruthy();
      expect(t.body).toContain('{optOutUrl}');
    }
  });

  it('platformDisplayName maps platform ids to product names', () => {
    expect(platformDisplayName('shopify')).toBe('Shopify');
    expect(platformDisplayName('woocommerce')).toBe('WooCommerce');
    expect(platformDisplayName('wix')).toBe('Wix');
  });
});
