import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReferralTrackingConfigured, trackReferralSignup } from '@/entities/referral';

const KEY = 'FIRSTPROMOTER_API_KEY';

describe('trackReferralSignup', () => {
  const original = process.env[KEY];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('does nothing at all without an API key', async () => {
    delete process.env[KEY];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(isReferralTrackingConfigured()).toBe(false);
    await expect(
      trackReferralSignup({ userId: 'u1', email: 'a@b.test', refId: 'marie' })
    ).resolves.toEqual({ ok: true, skipped: 'not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports the lead with the id the store matches on', async () => {
    process.env[KEY] = 'test-key';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await trackReferralSignup({
      userId: 'user-42',
      email: 'marchand@boutique.test',
      refId: 'marie',
      ip: '203.0.113.7',
      createdAt: new Date('2026-09-03T10:00:00.000Z')
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://firstpromoter.com/api/v1/track/signup');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    const body = new URLSearchParams(init.body as string);
    // `uid` is what the Stripe customer carries as `fp_uid`: the two must be
    // the same value or the recurring commission never attaches.
    expect(body.get('uid')).toBe('user-42');
    expect(body.get('email')).toBe('marchand@boutique.test');
    expect(body.get('ref_id')).toBe('marie');
    expect(body.get('ip')).toBe('203.0.113.7');
    expect(body.get('created_at')).toBe('2026-09-03T10:00:00.000Z');
  });

  it('reports a refusal without throwing — a signup is never lost over this', async () => {
    process.env[KEY] = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }));
    await expect(
      trackReferralSignup({ userId: 'u1', email: 'a@b.test', refId: 'marie' })
    ).resolves.toMatchObject({ ok: false, status: 422 });
  });

  it('survives the network being down', async () => {
    process.env[KEY] = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      trackReferralSignup({ userId: 'u1', email: 'a@b.test', refId: 'marie' })
    ).resolves.toMatchObject({ ok: false, status: null });
  });
});
