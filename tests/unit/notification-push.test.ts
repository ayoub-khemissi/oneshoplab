import { describe, expect, it } from 'vitest';
import { pushBodyFor, pushPayloadFor } from '@/entities/notification/lib/notification-push';

const field = (name: string) =>
  ({ title: 'Titre', description: 'Description', tags: 'Tags' })[name] ?? name;

describe('pushBodyFor', () => {
  it('says which field was rewritten, and shows it', () => {
    expect(
      pushBodyFor(
        { kind: 'chat_completed', payload: { field: 'title', preview: 'Coussin Lin Lavé' } },
        field
      )
    ).toBe('Titre : Coussin Lin Lavé');
  });

  it('falls back to the label alone when the preview is missing', () => {
    expect(pushBodyFor({ kind: 'chat_completed', payload: { field: 'tags' } }, field)).toBe('Tags');
  });

  it('carries the domain and the score of a finished audit', () => {
    expect(
      pushBodyFor({ kind: 'audit_completed', payload: { domain: 'shop.test', score: 72 } }, field)
    ).toBe('shop.test · 72/100');
  });

  it('drops the score when the audit failed', () => {
    expect(
      pushBodyFor({ kind: 'audit_failed', payload: { domain: 'shop.test', score: 0 } }, field)
    ).toBe('shop.test');
  });

  it('counts a bulk run', () => {
    expect(
      pushBodyFor({ kind: 'bulk_completed', payload: { generated: 8, total: 12 } }, field)
    ).toBe('8/12');
  });

  it('names the key and the store of an integration alert', () => {
    expect(
      pushBodyFor(
        {
          kind: 'integration_key_expiring',
          payload: { keyName: 'Boutique', siteName: 'shop.test' }
        },
        field
      )
    ).toBe('Boutique · shop.test');
  });

  it('says nothing rather than something wrong when the payload is empty', () => {
    expect(pushBodyFor({ kind: 'image_completed', payload: null }, field)).toBe('');
  });
});

describe('pushPayloadFor', () => {
  it('speaks the account language and opens the screen the bell opens', async () => {
    const payload = await pushPayloadFor(
      {
        kind: 'chat_completed',
        projectId: 'p1',
        productId: 'x1',
        payload: { field: 'title', preview: 'Coussin' }
      },
      'fr',
      'https://oneshoplab.com'
    );
    expect(payload.title).toBe('Texte généré');
    // Down to the row: a tap lands on the title that was rewritten, not at
    // the top of a page the merchant then has to search.
    expect(payload.url).toBe(
      'https://oneshoplab.com/fr/dashboard/sites/p1/products/x1#field-title'
    );
    expect(payload.tag).toBe('chat_completed:x1');
  });

  it('falls back to English on a locale we do not have', async () => {
    const payload = await pushPayloadFor(
      { kind: 'audit_completed', auditId: 'a1' },
      'xx',
      'https://x.test'
    );
    expect(payload.title).toBe('Audit completed');
    expect(payload.url).toBe('https://x.test/en/dashboard');
  });

  it('lands on the integrations tab for a connection alert', async () => {
    const payload = await pushPayloadFor(
      { kind: 'integration_token_invalid', projectId: 'p9' },
      'fr',
      'https://x.test'
    );
    expect(payload.url).toBe('https://x.test/fr/dashboard/sites/p9?tab=integrations');
  });
});
