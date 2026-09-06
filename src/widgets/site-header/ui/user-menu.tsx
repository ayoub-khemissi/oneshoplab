'use client';

import { Avatar } from '@heroui/react';
import {
  BadgeEuro,
  Coins,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  UserCircle2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { signOutAction } from '@/features/account/actions';
import { unsubscribeFromWebPush } from '@/features/push-notifications/client';
import { createPortalSessionAction } from '@/features/billing/actions';

interface UserMenuProps {
  name: string | null | undefined;
  email: string | null | undefined;
  image: string | null | undefined;
  creditsBalance: number;
  /** Plan id from session — drives which subscription action we expose. */
  plan: 'free' | 'starter' | 'pro' | 'scale';
  creditsLabel: string;
  planLabel: string;
  dashboardLabel: string;
  profileLabel: string;
  subscriptionLabel: string;
  affiliateLabel: string;
  preferencesLabel: string;
  buyCreditsLabel: string;
  manageSubscriptionLabel: string;
  upgradeLabel: string;
  signOutLabel: string;
  signedInAsLabel: string;
}

/**
 * Header user menu: HeroUI Avatar trigger that opens a small dropdown with
 * the user's identity, credit balance, dashboard link and sign-out action.
 * Closes on outside click or Escape.
 */
export function UserMenu({
  name,
  email,
  image,
  creditsBalance,
  plan,
  creditsLabel,
  planLabel,
  dashboardLabel,
  profileLabel,
  subscriptionLabel,
  affiliateLabel,
  preferencesLabel,
  buyCreditsLabel,
  manageSubscriptionLabel,
  upgradeLabel,
  signOutLabel,
  signedInAsLabel
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const display = name ?? email ?? '';
  const initials =
    display
      .replace(/[^a-zA-Z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--background)]"
        data-tour="account-menu"
        aria-label="Open user menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar size="sm" className="size-8">
          {image ? <Avatar.Image src={image} alt={display} /> : null}
          <Avatar.Fallback className="text-xs font-semibold">{initials}</Avatar.Fallback>
        </Avatar>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[240px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-lg overflow-hidden z-30"
        >
          <div className="px-3 py-2.5 border-b border-[var(--border)] flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-mono">
              {signedInAsLabel}
            </span>
            {name ? <p className="text-sm font-medium truncate">{name}</p> : null}
            <p className="text-xs text-[var(--muted)] truncate">{email}</p>
          </div>
          <div className="px-3 py-2 border-b border-[var(--border)] text-xs flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted)]">{planLabel}</span>
              <span className="font-mono font-semibold uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                {plan}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted)]">{creditsLabel}</span>
              <span className="font-mono font-semibold">{creditsBalance}</span>
            </div>
          </div>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <LayoutDashboard className="size-4 text-[var(--muted)]" />
            {dashboardLabel}
          </Link>
          <Link
            href="/account/profile"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <UserCircle2 className="size-4 text-[var(--muted)]" />
            {profileLabel}
          </Link>
          <Link
            href="/account/subscription"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <CreditCard className="size-4 text-[var(--muted)]" />
            {subscriptionLabel}
          </Link>
          <Link
            href="/account/affiliate"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <BadgeEuro className="size-4 text-[var(--muted)]" />
            {affiliateLabel}
          </Link>
          <Link
            href="/account/preferences"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <Settings className="size-4 text-[var(--muted)]" />
            {preferencesLabel}
          </Link>
          <Link
            href="/account/credits"
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <Coins className="size-4 text-[var(--muted)]" />
            {buyCreditsLabel}
          </Link>
          {plan === 'free' ? (
            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className="px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2 text-[var(--accent)] font-medium"
              role="menuitem"
            >
              <Sparkles className="size-4" />
              {upgradeLabel}
            </Link>
          ) : (
            <form action={createPortalSessionAction}>
              <button
                type="submit"
                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--default)] transition-colors flex items-center gap-2"
                role="menuitem"
              >
                <CreditCard className="size-4 text-[var(--muted)]" />
                {manageSubscriptionLabel}
              </button>
            </form>
          )}
          <form
            action={signOutAction}
            // Unregister this device first: after the sign-out the action has
            // no session to delete the subscription with, and the browser would
            // keep receiving the notifications of an account nobody is signed
            // into here any more.
            onSubmit={() => {
              void unsubscribeFromWebPush().catch(() => undefined);
            }}
          >
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--danger)]/10 text-[var(--danger)] transition-colors flex items-center gap-2 border-t border-[var(--border)]"
              role="menuitem"
            >
              <LogOut className="size-4" />
              {signOutLabel}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
