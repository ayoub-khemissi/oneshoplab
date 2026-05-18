'use client';

import { InputGroup, TextField } from '@heroui/react';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Shared debounced search box (HeroUI). Local state keeps typing
 * smooth; `onDebouncedChange` fires `delay`ms after the last keystroke
 * with the trimmed value. Re-syncs from `value` when it changes
 * externally (URL back/forward, reset). Used by the products tab and
 * the bulk-generation modal so both behave identically.
 *
 * `name="q"` (not a static `id`): HeroUI v3 mirrors the value into a
 * hidden input, so a static id would land on two elements (DevTools
 * "duplicate form field id"). A duplicated name is fine and still
 * satisfies the "field should have id or name" hint.
 */
export function DebouncedSearchInput({
  value,
  onDebouncedChange,
  placeholder,
  ariaLabel,
  delay = 350,
  className
}: {
  value: string;
  onDebouncedChange: (q: string) => void;
  placeholder: string;
  ariaLabel: string;
  delay?: number;
  className?: string;
}) {
  const [input, setInput] = useState(value);

  useEffect(() => {
    setInput(value);
  }, [value]);

  useEffect(() => {
    if (input === value) return;
    const id = window.setTimeout(() => onDebouncedChange(input.trim()), delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  return (
    <TextField
      name="q"
      aria-label={ariaLabel}
      value={input}
      onChange={setInput}
      className={className}
    >
      <InputGroup>
        <InputGroup.Prefix>
          <Search className="size-4" />
        </InputGroup.Prefix>
        <InputGroup.Input type="search" placeholder={placeholder} />
      </InputGroup>
    </TextField>
  );
}
