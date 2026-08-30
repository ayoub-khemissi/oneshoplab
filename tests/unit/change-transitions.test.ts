import { describe, expect, it } from 'vitest';
import {
  CHANGE_TRANSITIONS,
  TERMINAL_CHANGE_STATUSES,
  canTransitionChange
} from '@/entities/product-change';
import { PRODUCT_CHANGE_STATUSES } from '@/shared/db/schema';

describe('product change transition table', () => {
  it('covers every status exactly once as a target', () => {
    expect(Object.keys(CHANGE_TRANSITIONS).sort()).toEqual([...PRODUCT_CHANGE_STATUSES].sort());
  });
  it('pending reaches every terminal status', () => {
    for (const s of TERMINAL_CHANGE_STATUSES) expect(canTransitionChange('pending', s)).toBe(true);
  });
  it('terminal statuses are final', () => {
    for (const from of TERMINAL_CHANGE_STATUSES) {
      for (const to of PRODUCT_CHANGE_STATUSES) expect(canTransitionChange(from, to)).toBe(false);
    }
    expect(canTransitionChange('pending', 'pending')).toBe(false);
  });
});
