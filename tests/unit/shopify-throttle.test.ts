import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SINGLE_QUERY_COST,
  createAdminClient,
  projectStatus,
  throttleDelayMs
} from '@/features/shopify-connector';

const status = { maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 };

describe('throttle math', () => {
  it('waits exactly for the missing points at restoreRate', () => {
    expect(throttleDelayMs(null, 500)).toBe(0);
    expect(throttleDelayMs({ ...status, currentlyAvailable: 600 }, 500)).toBe(0);
    expect(throttleDelayMs(status, 500)).toBe(4000);
    expect(throttleDelayMs(status, 150)).toBe(500);
    // Never asks for more than the bucket can hold.
    expect(throttleDelayMs({ ...status, maximumAvailable: 300 }, 5000)).toBe(2000);
    expect(throttleDelayMs({ ...status, restoreRate: 0 }, 200)).toBe(2000);
    expect(MAX_SINGLE_QUERY_COST).toBe(1000);
  });
  it('projects the bucket refill over elapsed time, capped at the maximum', () => {
    expect(projectStatus(status, 3000).currentlyAvailable).toBe(400);
    expect(projectStatus(status, 60_000).currentlyAvailable).toBe(2000);
    expect(projectStatus(status, -5).currentlyAvailable).toBe(100);
  });
});

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}
const cost = (currentlyAvailable: number, requested = 400) => ({
  extensions: {
    cost: {
      requestedQueryCost: requested,
      actualQueryCost: requested,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable, restoreRate: 100 }
    }
  }
});

describe('admin client', () => {
  it('sleeps before the next call when the bucket cannot afford it, retries THROTTLED, maps 401', async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: { shop: { name: 'A' } }, ...cost(100) }))
      .mockResolvedValueOnce(
        response({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          ...cost(0)
        })
      )
      .mockResolvedValueOnce(response({ data: { shop: { name: 'B' } }, ...cost(1500) }))
      .mockResolvedValueOnce(response({ errors: [{ message: 'Unauthorized' }] }, { status: 401 }));
    const client = createAdminClient({
      shopDomain: 'a.myshopify.com',
      accessToken: 'shpat_x',
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      }
    });
    await client.shopInfo();
    expect(sleeps).toEqual([]);
    expect(client.throttle()?.currentlyAvailable).toBe(100);
    await client.shopInfo();
    // 1st: budget 100 < 400 → 3 s; THROTTLED with 0 left → 4 s; then success.
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThan(2900);
    expect(sleeps[0]).toBeLessThanOrEqual(3000);
    expect(sleeps[1]).toBe(4000);
    await expect(client.shopInfo()).rejects.toMatchObject({ code: 'token_invalid', status: 401 });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init?.headers as Record<string, string>)['x-shopify-access-token']).toBe('shpat_x');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://a.myshopify.com/admin/api/2025-07/graphql.json'
    );
  });
  it('surfaces userErrors and network failures with their codes', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            productUpdate: {
              product: null,
              userErrors: [{ field: ['title'], message: 'too long' }]
            }
          }
        })
      )
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const client = createAdminClient({
      shopDomain: 'a.myshopify.com',
      accessToken: 't',
      fetchImpl
    });
    await expect(client.productUpdate({ id: '1', title: 'x' })).rejects.toMatchObject({
      code: 'user_errors',
      message: 'productUpdate: title: too long'
    });
    await expect(client.shopInfo()).rejects.toMatchObject({ code: 'network' });
  });
});
