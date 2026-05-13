'use client';

import { Button, Drawer, ListBox } from '@heroui/react';
import {
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  Repeat,
  Settings,
  Tag,
  User2
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { signOutAction } from '@/lib/auth-actions';
import { DiscordGlyph } from './discord-glyph';

interface MobileMenuProps {
  user: {
    name: string | null;
    email: string | null;
    plan: string;
    creditsBalance: number;
  } | null;
  /** Pre-formatted credit balance using the visitor's locale. */
  creditsDisplay: string;
  labels: {
    signIn: string;
    signUp: string;
    pricing: string;
    dashboard: string;
    credits: string;
    signedInAs: string;
    profile: string;
    subscription: string;
    preferences: string;
    buyCredits: string;
    signOut: string;
    appearance: string;
    language: string;
    closeMenu: string;
    openMenu: string;
    menuTitle: string;
    joinDiscord: string;
  };
  /** Public Discord invite URL — optional. When set, a Discord link
   *  appears below the primary nav so visitors can jump to the
   *  community server. */
  discordUrl?: string | null;
  /** Slot for the LocaleSwitcher client component (rendered by the
   *  parent so we don't duplicate the locale list). */
  localeSwitcher: ReactNode;
  /** Slot for the ThemeToggle. */
  themeToggle: ReactNode;
}

/**
 * Mobile-only burger button + slide-in <Drawer> from HeroUI. Replaces
 * the cramped horizontal nav on small screens with a right-anchored
 * panel containing nav links, account links (when signed-in), the
 * locale/theme switchers, and the auth CTAs.
 *
 * Desktop (`md+`) keeps the original full nav inside SiteHeader; this
 * component is hidden via `md:hidden`.
 */
export function MobileMenu({
  user,
  creditsDisplay,
  labels,
  localeSwitcher,
  themeToggle,
  discordUrl
}: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Drawer isOpen={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Trigger
        aria-label={labels.openMenu}
        className="md:hidden inline-flex items-center justify-center size-9 rounded-md hover:bg-[var(--default)] text-[var(--foreground)] transition-colors"
      >
        <Menu className="size-5" aria-hidden />
      </Drawer.Trigger>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="flex flex-col h-full">
            <Drawer.Header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <Drawer.Heading className="text-base font-bold tracking-tight">
                {labels.menuTitle}
              </Drawer.Heading>
              <Drawer.CloseTrigger
                aria-label={labels.closeMenu}
                className="size-9 rounded-md hover:bg-[var(--default)]"
              />
            </Drawer.Header>

            <Drawer.Body className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-4">
              {user ? (
                <div className="flex flex-col gap-1.5 px-2 pb-3 border-b border-[var(--border)]">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
                    {labels.signedInAs}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {user.email ?? user.name ?? '—'}
                  </span>
                  <Link
                    href="/account/credits"
                    onClick={() => setIsOpen(false)}
                    className="mt-1 inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-mono font-semibold hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    <Coins className="size-3.5" aria-hidden />
                    {creditsDisplay} {labels.credits}
                  </Link>
                </div>
              ) : null}

              {/* Primary nav — dashboard first when signed in (the
                  most useful destination), then pricing, then the
                  Discord shortcut if configured. Account-specific
                  rows live below a divider so they don't compete
                  visually with the public links. */}
              <ListBox aria-label={labels.menuTitle} className="flex flex-col gap-0.5">
                {user ? (
                  <ListBox.Item
                    id="dashboard"
                    href="/dashboard"
                    textValue={labels.dashboard}
                    onAction={() => setIsOpen(false)}
                  >
                    <LayoutDashboard
                      className="size-4 mr-2 text-[var(--muted)]"
                      aria-hidden
                    />
                    {labels.dashboard}
                  </ListBox.Item>
                ) : null}
                <ListBox.Item
                  id="pricing"
                  href="/pricing"
                  textValue={labels.pricing}
                  onAction={() => setIsOpen(false)}
                >
                  <Tag className="size-4 mr-2 text-[var(--muted)]" aria-hidden />
                  {labels.pricing}
                </ListBox.Item>
                {discordUrl ? (
                  <ListBox.Item
                    id="discord"
                    href={discordUrl}
                    target="_blank"
                    textValue={labels.joinDiscord}
                    onAction={() => setIsOpen(false)}
                  >
                    <DiscordGlyph className="size-4 mr-2 text-[#5865F2]" />
                    {labels.joinDiscord}
                  </ListBox.Item>
                ) : null}
              </ListBox>

              {user ? (
                <ListBox
                  aria-label="Account"
                  className="flex flex-col gap-0.5 border-t border-[var(--border)] pt-3"
                >
                  <ListBox.Item
                    id="profile"
                    href="/account/profile"
                    textValue={labels.profile}
                    onAction={() => setIsOpen(false)}
                  >
                    <User2 className="size-4 mr-2 text-[var(--muted)]" aria-hidden />
                    {labels.profile}
                  </ListBox.Item>
                  <ListBox.Item
                    id="preferences"
                    href="/account/preferences"
                    textValue={labels.preferences}
                    onAction={() => setIsOpen(false)}
                  >
                    <Settings className="size-4 mr-2 text-[var(--muted)]" aria-hidden />
                    {labels.preferences}
                  </ListBox.Item>
                  <ListBox.Item
                    id="subscription"
                    href="/account/subscription"
                    textValue={labels.subscription}
                    onAction={() => setIsOpen(false)}
                  >
                    <Repeat className="size-4 mr-2 text-[var(--muted)]" aria-hidden />
                    {labels.subscription}
                  </ListBox.Item>
                  <ListBox.Item
                    id="credits"
                    href="/account/credits"
                    textValue={labels.buyCredits}
                    onAction={() => setIsOpen(false)}
                  >
                    <Coins className="size-4 mr-2 text-[var(--muted)]" aria-hidden />
                    {labels.buyCredits}
                  </ListBox.Item>
                </ListBox>
              ) : null}

              <div className="border-t border-[var(--border)] pt-4 px-2 flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--muted)]">{labels.language}</span>
                {localeSwitcher}
              </div>
              <div className="px-2 flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--muted)]">{labels.appearance}</span>
                {themeToggle}
              </div>
            </Drawer.Body>

            <Drawer.Footer className="border-t border-[var(--border)] p-4 flex flex-col gap-2">
              {user ? (
                <form action={signOutAction} className="contents">
                  <Button type="submit" variant="secondary" fullWidth>
                    <LogOut className="size-4" aria-hidden />
                    {labels.signOut}
                  </Button>
                </form>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setIsOpen(false)}
                    className="text-center px-3 py-2 rounded-md border border-[var(--border)] hover:bg-[var(--default)] transition-colors text-sm"
                  >
                    {labels.signIn}
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setIsOpen(false)}
                    className="text-center px-3 py-2 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90 font-medium text-sm transition-opacity"
                  >
                    {labels.signUp}
                  </Link>
                </>
              )}
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
