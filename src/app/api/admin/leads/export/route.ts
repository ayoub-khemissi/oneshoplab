import { and, desc, eq, isNotNull, isNull, like } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail } from '@/entities/user';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { leads, LEAD_STATUSES, PLATFORMS, type LeadStatus, type Platform } from '@/lib/db/schema';

/**
 * CSV export of leads, optionally filtered by status / platform /
 * language. Mirrors the admin page's filter set so the user can dump
 * exactly what they see.
 *
 * Auth: admin-only (same gate as the page). Anyone else gets a 403
 * — not a redirect — because this is an API endpoint.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const statusRaw = sp.get('status');
  const platformRaw = sp.get('platform');
  const languageRaw = sp.get('language')?.trim().slice(0, 8) || null;
  const queryRaw = sp.get('q')?.trim().slice(0, 120) || null;
  const hasEmailRaw = sp.get('hasEmail');
  const hasEmail = hasEmailRaw === 'yes' || hasEmailRaw === 'no' ? hasEmailRaw : null;

  const status = (LEAD_STATUSES as readonly string[]).includes(statusRaw ?? '')
    ? (statusRaw as LeadStatus)
    : null;
  const platform = (PLATFORMS as readonly string[]).includes(platformRaw ?? '')
    ? (platformRaw as Platform)
    : null;

  const rows = await db.query.leads.findMany({
    where: and(
      status ? eq(leads.status, status) : undefined,
      platform ? eq(leads.platform, platform) : undefined,
      languageRaw ? eq(leads.language, languageRaw) : undefined,
      queryRaw ? like(leads.domain, `%${queryRaw}%`) : undefined,
      hasEmail === 'yes'
        ? isNotNull(leads.contactEmail)
        : hasEmail === 'no'
          ? isNull(leads.contactEmail)
          : undefined
    ),
    orderBy: [desc(leads.discoveredAt)]
  });

  const header = [
    'domain',
    'url',
    'platform',
    'language',
    'country',
    'products_sampled',
    'score',
    'contact_email',
    'contact_socials',
    'status',
    'notes',
    'discovered_via',
    'discovered_at',
    'qualified_at',
    'last_attempted_at'
  ];

  const lines = [header.join(',')];
  for (const r of rows) {
    const socials = Array.isArray(r.contactSocials)
      ? (r.contactSocials as string[]).join('; ')
      : '';
    lines.push(
      [
        r.domain,
        r.url,
        r.platform,
        r.language ?? '',
        r.country ?? '',
        String(r.productsSampled),
        r.score == null ? '' : String(r.score),
        r.contactEmail ?? '',
        socials,
        r.status,
        r.notes ?? '',
        r.discoveredVia ?? '',
        r.discoveredAt.toISOString(),
        r.qualifiedAt ? r.qualifiedAt.toISOString() : '',
        r.lastAttemptedAt ? r.lastAttemptedAt.toISOString() : ''
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${stamp}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * RFC 4180-ish field escape: wrap in double-quotes if the value
 * contains a comma, quote, or newline; double-up embedded quotes.
 */
function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
