/** SSRF guard for outbound webhook URLs: scheme, literal ranges, hostnames, DNS. */
import { describe, expect, it } from 'vitest';
import {
  checkWebhookUrl,
  checkWebhookUrlSync,
  isBlockedHostname,
  isPrivateAddress
} from '@/entities/outbound-webhook';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const lookupWith = (addresses: string[]) => async () =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('isPrivateAddress', () => {
  it('flags every private / loopback / link-local / special range', () => {
    for (const ip of [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.1.2.3',
      '64:ff9b::a00:1',
      '2002:c0a8:101::'
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('accepts public addresses and rejects garbage', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('checkWebhookUrlSync', () => {
  it('requires https', () => {
    expect(checkWebhookUrlSync('http://shop.example.com/hook')).toEqual({
      ok: false,
      reason: 'not_https'
    });
    expect(checkWebhookUrlSync('ftp://shop.example.com/')).toEqual({
      ok: false,
      reason: 'not_https'
    });
    expect(checkWebhookUrlSync('nope')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(checkWebhookUrlSync('https://user:pw@shop.example.com/')).toEqual({
      ok: false,
      reason: 'invalid_url'
    });
  });
  it('rejects literal private IPs, including bracketed IPv6', () => {
    expect(checkWebhookUrlSync('https://127.0.0.1/hook').ok).toBe(false);
    expect(checkWebhookUrlSync('https://[::1]/hook')).toEqual({
      ok: false,
      reason: 'private_address'
    });
    expect(checkWebhookUrlSync('https://169.254.169.254/latest')).toEqual({
      ok: false,
      reason: 'private_address'
    });
    expect(checkWebhookUrlSync('https://93.184.216.34/hook').ok).toBe(true);
  });
  it('blocks localhost, .local, .internal and bare names', () => {
    for (const h of [
      'localhost',
      'LOCALHOST.',
      'a.localhost',
      'printer.local',
      'db.internal',
      'x.home.arpa'
    ]) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
    expect(isBlockedHostname('shop.example.com')).toBe(false);
    expect(checkWebhookUrlSync('https://localhost/hook')).toEqual({
      ok: false,
      reason: 'blocked_host'
    });
    expect(checkWebhookUrlSync('https://intranet/hook')).toEqual({
      ok: false,
      reason: 'blocked_host'
    });
  });
});

describe('checkWebhookUrl (DNS)', () => {
  it('accepts a host resolving to public addresses only', async () => {
    const res = await checkWebhookUrl('https://shop.example.com/wp-json/x', async () => PUBLIC);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.addresses).toEqual(['93.184.216.34']);
  });
  it('rejects when any resolved address is private (rebinding / split horizon)', async () => {
    const res = await checkWebhookUrl(
      'https://shop.example.com/hook',
      lookupWith(['93.184.216.34', '10.0.0.5'])
    );
    expect(res).toEqual({ ok: false, reason: 'private_address' });
    expect(await checkWebhookUrl('https://shop.example.com/', lookupWith(['::1']))).toEqual({
      ok: false,
      reason: 'private_address'
    });
  });
  it('reports DNS failures and empty answers', async () => {
    expect(
      await checkWebhookUrl('https://shop.example.com/', async () => {
        throw new Error('ENOTFOUND');
      })
    ).toEqual({ ok: false, reason: 'dns_failed' });
    expect(await checkWebhookUrl('https://shop.example.com/', lookupWith([]))).toEqual({
      ok: false,
      reason: 'dns_failed'
    });
  });
  it('does not resolve literal IPs', async () => {
    let called = false;
    const res = await checkWebhookUrl('https://93.184.216.34/', async () => {
      called = true;
      return PUBLIC;
    });
    expect(res.ok).toBe(true);
    expect(called).toBe(false);
  });
});
