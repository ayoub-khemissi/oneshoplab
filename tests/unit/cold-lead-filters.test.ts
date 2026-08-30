/**
 * Cold-outreach hygiene. Each rule maps to a real incident (an rgpd@ mailbox
 * got a pitch; scraped placeholders; digit myshopify staging stores; a
 * malformed `/@dom.fr` hard-bounce) — see the comments in the module.
 */
import { describe, expect, it } from 'vitest';
import {
  isGibberishMyshopify,
  isPlaceholderAddress,
  isSensitiveAddress,
  isValidContactEmail
} from '@/entities/lead';

describe('isSensitiveAddress', () => {
  it.each([
    'rgpd@shop.fr',
    'DPO@shop.fr',
    'dpo.eu@shop.fr',
    'legal-team@shop.fr',
    'privacy_x@shop.fr',
    'noreply@shop.fr',
    'abuse+x@shop.fr'
  ])('blocks %s', (e) => expect(isSensitiveAddress(e)).toBe(true));
  it.each([
    'info@shop.fr',
    'contact@shop.fr',
    'hello@shop.fr',
    'sales@shop.fr',
    'legalize@shop.fr',
    'marie.dupont@shop.fr'
  ])('allows %s (generic business inboxes are the target)', (e) =>
    expect(isSensitiveAddress(e)).toBe(false)
  );
});

describe('isPlaceholderAddress', () => {
  it('drops scraper stand-ins and keeps real people', () => {
    expect(isPlaceholderAddress('jean.dupont@shop.fr')).toBe(true);
    expect(isPlaceholderAddress('John.Doe@shop.fr')).toBe(true);
    expect(isPlaceholderAddress('test@shop.fr')).toBe(true);
    expect(isPlaceholderAddress('jean.dupontel@shop.fr')).toBe(false);
    expect(isPlaceholderAddress('testard@shop.fr')).toBe(false);
  });
});

describe('isGibberishMyshopify', () => {
  it('flags digit-bearing myshopify subdomains only', () => {
    expect(isGibberishMyshopify('02e96b.myshopify.com')).toBe(true);
    expect(isGibberishMyshopify('0ymzia-df.myshopify.com')).toBe(true);
    expect(isGibberishMyshopify('burlebo.myshopify.com')).toBe(false);
    expect(isGibberishMyshopify('shop24.com')).toBe(false);
    expect(isGibberishMyshopify('brand2.fr')).toBe(false);
  });
});

describe('isValidContactEmail', () => {
  it.each(['marie@shop.fr', 'm.dupont+news@shop.co.uk', "o'neil@shop.ie"])('accepts %s', (e) =>
    expect(isValidContactEmail(e)).toBe(true)
  );
  it.each([
    '/@dom.fr',
    '//www.tiktok.com/@brand',
    'a@b',
    'a@@b.fr',
    'a..b@shop.fr',
    '@shop.fr',
    'a b@shop.fr',
    'a@shop'
  ])('rejects %s', (e) => expect(isValidContactEmail(e)).toBe(false));
});
