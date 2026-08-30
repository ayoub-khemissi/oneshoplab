import { useEffect, useState } from 'react';

/** Tracks the wait between retries so we can show "next attempt in Xs". */
export function useCountdownTo(targetMs: number | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (targetMs == null) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((targetMs - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [targetMs]);
  return remaining;
}

/** Tracks how long the current attempt has been running. */
export function useElapsedSinceMs(startMs: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startMs == null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [startMs]);
  return elapsed;
}
