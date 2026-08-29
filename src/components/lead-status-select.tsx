'use client';

import { ListBox, Select } from '@heroui/react';
import { useTransition } from 'react';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/db/schema';
import { updateLeadStatusAction } from '@/lib/leads/actions';

/**
 * HeroUI Select wrapper that calls the status server action via
 * `useTransition` rather than wrapping the dropdown in a <form> —
 * the HeroUI Select isn't a native <select> so it doesn't
 * participate in form submission. Constructing FormData manually
 * keeps the action signature unchanged.
 */
export function LeadStatusSelect({ leadId, current }: { leadId: string; current: LeadStatus }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(key: string | number | null): void {
    if (!key || key === current) return;
    const fd = new FormData();
    fd.set('leadId', leadId);
    fd.set('status', String(key));
    startTransition(async () => {
      await updateLeadStatusAction(fd);
    });
  }

  return (
    <Select
      selectedKey={current}
      onSelectionChange={handleChange}
      aria-label="Status"
      isDisabled={isPending}
      className="min-w-[120px]"
    >
      <Select.Trigger className="text-xs h-7 px-2">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {LEAD_STATUSES.map((s) => (
            <ListBox.Item key={s} id={s} textValue={s}>
              {s}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
