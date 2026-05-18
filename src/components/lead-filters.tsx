'use client';

import { Button, Input, Label, ListBox, Select, TextField } from '@heroui/react';
import { Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const PLATFORM_OPTIONS = [
  { id: '', label: 'Toutes' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'woocommerce', label: 'WooCommerce' },
  { id: 'wix', label: 'Wix' }
] as const;

/**
 * Platform + language filter row. Pushes `?platform=…&language=…`
 * onto the URL so the server page re-renders with the new query —
 * keeps the page itself a Server Component but lets us use HeroUI's
 * React-driven inputs for the controls.
 */
export function LeadFilters({
  initialPlatform,
  initialLanguage
}: {
  initialPlatform: string | null;
  initialLanguage: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [platform, setPlatform] = useState<string>(initialPlatform ?? '');
  const [language, setLanguage] = useState<string>(initialLanguage ?? '');

  function apply(): void {
    const params = new URLSearchParams(sp.toString());
    if (platform) params.set('platform', platform);
    else params.delete('platform');
    const trimmed = language.trim();
    if (trimmed) params.set('language', trimmed);
    else params.delete('language');
    params.delete('page');
    router.push(`/dashboard/admin/leads?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Plateforme
        </Label>
        <Select
          selectedKey={platform}
          onSelectionChange={(k) => setPlatform(k == null ? '' : String(k))}
          aria-label="Plateforme"
          className="min-w-[160px]"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PLATFORM_OPTIONS.map((o) => (
                <ListBox.Item key={o.id || 'all'} id={o.id} textValue={o.label}>
                  {o.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <TextField
        value={language}
        onChange={(v) => setLanguage(v.slice(0, 8))}
        className="w-24"
        aria-label="Langue ISO-2"
      >
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Langue (ISO-2)
        </Label>
        <Input placeholder="fr" />
      </TextField>

      <Button variant="primary" onClick={apply}>
        Filtrer
      </Button>

      {/* Export uses the same query string so the operator dumps
          exactly what they see. Plain anchor — browser handles the
          download via Content-Disposition. */}
      <a
        href={`/api/admin/leads/export?${sp.toString()}`}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--default)]/40 transition-colors"
      >
        <Download className="size-3.5" aria-hidden />
        Export CSV
      </a>
    </div>
  );
}
