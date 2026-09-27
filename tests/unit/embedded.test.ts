import { describe, expect, it } from 'vitest';
import { embeddedLinkAction, filenameFromDisposition } from '@/shared/embedded/client';
import { embeddedRequestInfo as serverInfo } from '@/shared/embedded';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzaG9wIjoieCJ9.c2ln';
const ORIGIN = 'https://oneshoplab.com';

describe('embeddedRequestInfo', () => {
  it('reads the session from the Bearer header App Bridge adds', () => {
    expect(
      serverInfo({ secFetchDest: 'empty', authorization: `Bearer ${JWT}`, idTokenParam: null })
    ).toEqual({ embedded: true, bearer: JWT });
  });

  it('takes the id_token of a first document load', () => {
    expect(serverInfo({ secFetchDest: 'iframe', authorization: null, idTokenParam: JWT })).toEqual({
      embedded: true,
      bearer: JWT
    });
  });

  it('knows a framed document even without a token', () => {
    expect(serverInfo({ secFetchDest: 'iframe', authorization: null, idTokenParam: null })).toEqual(
      {
        embedded: true,
        bearer: null
      }
    );
  });

  it('ignores site API keys and plain visits', () => {
    expect(
      serverInfo({
        secFetchDest: 'document',
        authorization: 'Bearer osl_live_abc',
        idTokenParam: null
      })
    ).toEqual({ embedded: false, bearer: null });
    expect(serverInfo({ secFetchDest: null, authorization: null, idTokenParam: 'nope' })).toEqual({
      embedded: false,
      bearer: null
    });
  });
});

describe('embeddedLinkAction', () => {
  const link = (href: string, extra: Partial<{ target: string | null; download: boolean }> = {}) =>
    embeddedLinkAction({ href, target: null, download: false, ...extra }, ORIGIN);

  it('routes app pages through the client router', () => {
    expect(link('/fr/dashboard/sites/1')).toBe('navigate');
    expect(link(`${ORIGIN}/en/account/credits?x=1`)).toBe('navigate');
  });

  it('fetches API files instead of loading them as a document', () => {
    expect(link('/api/projects/1/export?productId=2')).toBe('download');
    expect(link('/api/import/template', { download: true })).toBe('download');
  });

  it('leaves new tabs, other origins, plain downloads and the embedded home alone', () => {
    expect(link('/fr/faq', { target: '_blank' })).toBe('ignore');
    expect(link('https://cdn.oneshoplab.com/x.png')).toBe('ignore');
    expect(link('/file.csv', { download: true })).toBe('ignore');
    expect(link('/shopify?locale=fr')).toBe('ignore');
    expect(link('http://[bad')).toBe('ignore');
  });
});

describe('filenameFromDisposition', () => {
  it('reads plain and UTF-8 file names, with a fallback', () => {
    expect(filenameFromDisposition('attachment; filename="catalog.csv"', 'x')).toBe('catalog.csv');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.csv", 'x')).toBe(
      'café.csv'
    );
    expect(filenameFromDisposition(null, 'export')).toBe('export');
  });
});
