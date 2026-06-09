'use client';

import { Button, Input, Label, ListBox, Select, TextField } from '@heroui/react';
import { Download, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const PLATFORM_OPTIONS = [
  { id: '', label: 'Toutes' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'woocommerce', label: 'WooCommerce' },
  { id: 'wix', label: 'Wix' },
  { id: 'manual', label: 'Manual (Magento/Presta/…)' },
  { id: 'unknown', label: 'Unknown (agences)' }
] as const;

const EMAIL_OPTIONS = [
  { id: '', label: 'Tous' },
  { id: 'yes', label: 'Avec email' },
  { id: 'no', label: 'Sans email' }
] as const;

/**
 * Filter row for the leads admin: domain search + platform + email
 * presence + language. Pushes the chosen filters onto the URL query so
 * the server page re-renders — keeps the page a Server Component while
 * using HeroUI's React-driven inputs for the controls.
 */
export function LeadFilters({
  initialPlatform,
  initialLanguage,
  initialQuery,
  initialHasEmail
}: {
  initialPlatform: string | null;
  initialLanguage: string | null;
  initialQuery: string | null;
  initialHasEmail: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [platform, setPlatform] = useState<string>(initialPlatform ?? '');
  const [language, setLanguage] = useState<string>(initialLanguage ?? '');
  const [query, setQuery] = useState<string>(initialQuery ?? '');
  const [hasEmail, setHasEmail] = useState<string>(initialHasEmail ?? '');

  function apply(): void {
    const params = new URLSearchParams(sp.toString());
    const setOrDelete = (key: string, value: string) => {
      const v = value.trim();
      if (v) params.set(key, v);
      else params.delete(key);
    };
    setOrDelete('q', query);
    setOrDelete('platform', platform);
    setOrDelete('language', language);
    setOrDelete('hasEmail', hasEmail);
    params.delete('page');
    router.push(`/dashboard/admin/leads?${params.toString()}`);
  }

  function reset(): void {
    router.push('/dashboard/admin/leads');
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
      {/* Domain search ------------------------------------------------- */}
      <TextField
        value={query}
        onChange={(v) => setQuery(v.slice(0, 120))}
        className="min-w-[200px] flex-1 max-w-xs"
        aria-label="Recherche par domaine"
      >
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Recherche (domaine)
        </Label>
        <Input
          placeholder="ex: bonnegueule"
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
      </TextField>

      {/* Platform ------------------------------------------------------ */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Plateforme
        </Label>
        <Select
          selectedKey={platform}
          onSelectionChange={(k) => setPlatform(k == null ? '' : String(k))}
          aria-label="Plateforme"
          className="min-w-[180px]"
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

      {/* Email presence ------------------------------------------------ */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Email
        </Label>
        <Select
          selectedKey={hasEmail}
          onSelectionChange={(k) => setHasEmail(k == null ? '' : String(k))}
          aria-label="Présence email"
          className="min-w-[130px]"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {EMAIL_OPTIONS.map((o) => (
                <ListBox.Item key={o.id || 'all'} id={o.id} textValue={o.label}>
                  {o.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {/* Language ------------------------------------------------------ */}
      <TextField
        value={language}
        onChange={(v) => setLanguage(v.slice(0, 8))}
        className="w-24"
        aria-label="Langue ISO-2"
      >
        <Label className="text-xs uppercase tracking-wider text-[var(--muted)]">
          Langue
        </Label>
        <Input
          placeholder="fr"
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
      </TextField>

      <Button variant="primary" onClick={apply}>
        <Search className="size-3.5" aria-hidden />
        Filtrer
      </Button>
      <Button variant="ghost" onClick={reset}>
        Réinitialiser
      </Button>

      {/* Export uses the same query string so the operator dumps exactly
          what they see. Plain anchor — browser handles the download via
          Content-Disposition. */}
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
