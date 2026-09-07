/**
 * One rule for the key a generation is filed under. Two call sites used the
 * audit snapshot's key while the page used the row's; on a connected Wix
 * store those differ, and a paid, notified title never appeared on its page.
 */
import { describe, expect, it } from 'vitest';
import { productSourceKey } from '@/entities/product/lib/source-key';

describe('productSourceKey', () => {
  it('prefers the platform id, then the handle, then the row id', () => {
    expect(productSourceKey({ id: 'row', sourceId: 'df8a', handle: 'crew' })).toBe('df8a');
    expect(productSourceKey({ id: 'row', sourceId: null, handle: 'crew' })).toBe('crew');
    expect(productSourceKey({ id: 'row', sourceId: null, handle: null })).toBe('row');
  });
});
