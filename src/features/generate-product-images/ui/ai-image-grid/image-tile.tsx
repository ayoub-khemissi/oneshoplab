'use client';

import { useState } from 'react';
import { CompletedTile } from './completed-tile';
import { ExpiredTile } from './expired-tile';
import { FailedTile } from './failed-tile';
import { PendingTile } from './pending-tile';
import type { BusyKind } from './types';
import type { ImageJobRow } from '@/entities/generation-job';

interface ImageTileProps {
  job: ImageJobRow;
  now: number;
  costPerImage: number;
  retentionDays: number;
  isBusy: BusyKind | undefined;
  onDelete: () => void;
  onRegenerate: () => void;
}

/** Per-job tile — switches presentation based on status. */
export function ImageTile({
  job,
  now,
  costPerImage,
  retentionDays,
  isBusy,
  onDelete,
  onRegenerate
}: ImageTileProps) {
  // Confirmation guard for the destructive paths only (failed +
  // completed). Pending/running cancellations skip the dialog since
  // they're reversible (credits get refunded) and asking for
  // confirmation each time would be friction the merchant doesn't
  // need on an in-flight job.
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (job.status === 'pending' || job.status === 'running') {
    return <PendingTile job={job} now={now} isBusy={isBusy} onDelete={onDelete} />;
  }

  if (job.status === 'failed' || job.status === 'timed_out') {
    return (
      <FailedTile
        job={job}
        costPerImage={costPerImage}
        isBusy={isBusy}
        confirmOpen={confirmOpen}
        setConfirmOpen={setConfirmOpen}
        onDelete={onDelete}
        onRegenerate={onRegenerate}
      />
    );
  }

  // completed
  const url = job.imageUrl;
  if (!url) {
    return (
      <ExpiredTile
        costPerImage={costPerImage}
        isBusy={isBusy}
        onDelete={onDelete}
        onRegenerate={onRegenerate}
      />
    );
  }
  return (
    <CompletedTile
      job={job}
      url={url}
      costPerImage={costPerImage}
      retentionDays={retentionDays}
      isBusy={isBusy}
      confirmOpen={confirmOpen}
      setConfirmOpen={setConfirmOpen}
      onDelete={onDelete}
      onRegenerate={onRegenerate}
    />
  );
}
