import { describe, expect, it } from 'vitest';
import { canTransition, JOB_TRANSITIONS, TERMINAL_JOB_STATUSES } from '@/lib/jobs/transitions';
import { JOB_STATUSES } from '@/lib/db/schema';

describe('job transition table', () => {
  it('covers every status exactly once as a target', () => {
    expect(Object.keys(JOB_TRANSITIONS).sort()).toEqual([...JOB_STATUSES].sort());
  });
  it('terminal statuses can only be left by a retry', () => {
    for (const s of TERMINAL_JOB_STATUSES) {
      const exits = JOB_STATUSES.filter((t) => canTransition(s, t));
      if (s === 'completed') expect(exits).toEqual([]);
      else expect(exits.sort()).toEqual(['pending', 'running']);
    }
  });
  it('completed is re-openable only with force', () => {
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('completed', 'running', true)).toBe(true);
    expect(canTransition('completed', 'failed', true)).toBe(false);
  });
  it('the happy path and the failure paths are open', () => {
    expect(canTransition('pending', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'timed_out')).toBe(true);
    expect(canTransition('pending', 'completed')).toBe(true); // sync chat jobs
    expect(canTransition('running', 'running')).toBe(true); // refresh kieTaskId
  });
});
