import { Button, Card } from '@heroui/react';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ExternalLink, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LeadBulkPaste } from '@/components/lead-bulk-paste';
import { LeadFilters } from '@/components/lead-filters';
import { LeadNotesEditor } from '@/components/lead-notes-editor';
import { LeadStatusSelect } from '@/components/lead-status-select';
import { isAdminEmail } from '@/lib/admin';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  leads,
  LEAD_STATUSES,
  PLATFORMS,
  type LeadStatus,
  type Platform
} from '@/lib/db/schema';
import { deleteLeadAction } from '@/lib/leads/actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leads · OneShopLab admin',
  robots: { index: false, follow: false }
};

interface PageProps {
  searchParams: Promise<{
    status?: string;
    platform?: string;
    language?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

function asStatusFilter(v: string | undefined): LeadStatus | null {
  if (!v) return null;
  return (LEAD_STATUSES as readonly string[]).includes(v) ? (v as LeadStatus) : null;
}

function asPlatformFilter(v: string | undefined): Platform | null {
  if (!v) return null;
  return (PLATFORMS as readonly string[]).includes(v) ? (v as Platform) : null;
}

const STATUS_TONES: Record<LeadStatus, string> = {
  new: 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/30',
  contacted: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30',
  replied: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  won: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30',
  lost: 'bg-[var(--muted)]/15 text-[var(--muted)] border-[var(--border)]',
  dead: 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30'
};

export default async function LeadsAdminPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/dashboard/admin/leads');
  if (!isAdminEmail(session.user.email)) redirect('/dashboard');

  const sp = await searchParams;
  const statusFilter = asStatusFilter(sp.status);
  const platformFilter = asPlatformFilter(sp.platform);
  const languageFilter = sp.language?.trim().slice(0, 8) ?? null;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const whereExpr = and(
    statusFilter ? eq(leads.status, statusFilter) : undefined,
    platformFilter ? eq(leads.platform, platformFilter) : undefined,
    languageFilter ? eq(leads.language, languageFilter) : undefined
  );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(whereExpr);

  const rows = await db.query.leads.findMany({
    where: whereExpr,
    orderBy: [desc(leads.discoveredAt)],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE
  });

  // Counters by status — small enough to render as filter chips with
  // their live counts, no extra round-trip.
  const totals = await db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.status);
  const totalByStatus = new Map<LeadStatus, number>();
  for (const t of totals) totalByStatus.set(t.status, Number(t.count));

  const totalPages = Math.max(1, Math.ceil(Number(count) / PAGE_SIZE));

  return (
    <main className="flex-1 px-4 md:px-10 py-8 max-w-7xl w-full mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
          Admin · Prospection
        </span>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          Sites e-commerce auto-découverts puis qualifiés (plateforme
          détectée + au moins un produit récupérable). Tu peux ajouter
          des URLs à la main via le formulaire en bas, ou utiliser le CLI
          (<code className="text-xs">pnpm tsx scripts/discover-leads.ts</code>)
          pour les passes plus larges.
        </p>
      </header>

      {/* Filters card ---------------------------------------------------- */}
      <Card variant="secondary" className="p-5 flex flex-col gap-4">
        {/* Status chips — server-side anchors, count badges. */}
        <nav className="flex flex-wrap gap-1.5" aria-label="Filtres status">
          <FilterChip
            href={buildHref(sp, { status: undefined, page: undefined })}
            active={!statusFilter}
            label={`Tous (${Number(count)})`}
          />
          {LEAD_STATUSES.map((s) => (
            <FilterChip
              key={s}
              href={buildHref(sp, { status: s, page: undefined })}
              active={statusFilter === s}
              label={`${s} (${totalByStatus.get(s) ?? 0})`}
              tone={STATUS_TONES[s]}
            />
          ))}
        </nav>

        {/* Platform + language inputs + export button. */}
        <LeadFilters
          initialPlatform={platformFilter}
          initialLanguage={languageFilter}
        />
      </Card>

      {/* Leads table card ----------------------------------------------- */}
      <Card variant="secondary" className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--default)]/40 border-b border-[var(--border)]">
              <tr className="text-left">
                <Th>Domain</Th>
                <Th>Platform</Th>
                <Th>Lang</Th>
                <Th>Products</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
                <Th>Notes</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-[var(--muted)]"
                  >
                    Aucun lead pour ce filtre. Colle des URLs en bas pour
                    démarrer.
                  </td>
                </tr>
              ) : null}
              {rows.map((l) => {
                const socials = Array.isArray(l.contactSocials)
                  ? (l.contactSocials as string[])
                  : [];
                return (
                  <tr
                    key={l.id}
                    className="border-b border-[var(--border)] last:border-b-0 align-top"
                  >
                    <Td>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 font-medium hover:text-[var(--accent)]"
                      >
                        {l.domain}
                        <ExternalLink
                          className="size-3 opacity-50"
                          aria-hidden
                        />
                      </a>
                      <div className="text-[10px] text-[var(--muted)] mt-0.5">
                        {new Date(l.discoveredAt).toLocaleDateString()}
                        {l.discoveredVia ? ` · ${l.discoveredVia}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-xs font-mono">{l.platform}</span>
                    </Td>
                    <Td>
                      <span className="text-xs font-mono">
                        {l.language ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs font-mono tabular-nums">
                        {l.productsSampled}
                      </span>
                    </Td>
                    <Td>
                      {l.contactEmail ? (
                        <a
                          href={`mailto:${l.contactEmail}`}
                          className="text-xs text-[var(--accent)] hover:underline break-all"
                        >
                          {l.contactEmail}
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                      {socials.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {socials.slice(0, 4).map((s) => {
                            const host = (() => {
                              try {
                                return new URL(s).hostname.replace(
                                  /^www\./,
                                  ''
                                );
                              } catch {
                                return s;
                              }
                            })();
                            return (
                              <a
                                key={s}
                                href={s}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--default)]/40 hover:bg-[var(--default)]/70"
                              >
                                {host.split('.')[0]}
                              </a>
                            );
                          })}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <LeadStatusSelect leadId={l.id} current={l.status} />
                    </Td>
                    <Td>
                      <LeadNotesEditor leadId={l.id} initial={l.notes ?? ''} />
                    </Td>
                    <Td>
                      <form action={deleteLeadAction}>
                        <input type="hidden" name="leadId" value={l.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label="Delete lead"
                          className="text-[var(--muted)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </form>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-center gap-1.5 text-sm"
          aria-label="Pagination"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={buildHref(sp, { page: String(p) })}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium tabular-nums transition-colors ${
                p === page
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/50'
              }`}
            >
              {p}
            </a>
          ))}
        </nav>
      ) : null}

      <LeadBulkPaste />
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3">{children}</td>;
}

function FilterChip({
  href,
  active,
  label,
  tone
}: {
  href: string;
  active: boolean;
  label: string;
  tone?: string;
}) {
  const base =
    'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border transition-colors';
  const cls = active
    ? `${tone ?? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'}`
    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/50';
  return (
    <a href={href} className={`${base} ${cls}`}>
      {label}
    </a>
  );
}

function buildHref(
  sp: Awaited<PageProps['searchParams']>,
  overrides: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  const merged = { ...sp, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/dashboard/admin/leads${qs ? `?${qs}` : ''}`;
}
