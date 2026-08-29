'use client';

import { useEffect, useState } from 'react';

/**
 * Live elapsed-time counter for an in-flight job. Re-renders once per second
 * while mounted; unmounts cleanly when the parent server component re-renders
 * with a terminal state.
 *
 * To avoid SSR/CSR hydration mismatches we keep the server output stable
 * (just `0s`) and only start ticking once the component has mounted on the
 * client. The first real value lands ~16ms after hydration, which feels
 * instantaneous and never produces a "Hydration failed" warning.
 */
export function ElapsedTimer({
  startedAt,
  avgSeconds,
  prefix
}: {
  startedAt: string | number | Date;
  avgSeconds?: number | null;
  prefix?: string;
}) {
  const startMs = typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime();

  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSeconds = now === null ? 0 : Math.max(0, Math.floor((now - startMs) / 1000));

  return (
    <span className="font-mono inline-flex items-center gap-1">
      {prefix ? <span>{prefix}</span> : null}
      <span>{elapsedSeconds}s</span>
      {avgSeconds && avgSeconds > 0 ? (
        <span className="opacity-70">· avg {Math.round(avgSeconds)}s</span>
      ) : null}
    </span>
  );
}
