'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isAdminEmail } from '@/entities/user';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import { leads, LEAD_STATUSES, type LeadStatus } from '@/shared/db/schema';
import { qualifyBatch } from './qualify';

/**
 * All mutations are auth-gated to ADMIN_EMAILS — this is internal
 * prospection tooling, not customer-facing functionality. We
 * silently no-op on unauthorised callers rather than throwing so a
 * stale form submission from a logged-out tab doesn't blow up the
 * page render.
 */
async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!isAdminEmail(email)) return null;
  return email;
}

const StatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(LEAD_STATUSES)
});

export async function updateLeadStatusAction(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const parsed = StatusSchema.safeParse({
    leadId: formData.get('leadId'),
    status: formData.get('status')
  });
  if (!parsed.success) return;
  await db
    .update(leads)
    .set({ status: parsed.data.status satisfies LeadStatus })
    .where(eq(leads.id, parsed.data.leadId));
  revalidatePath('/dashboard/admin/leads');
}

const NotesSchema = z.object({
  leadId: z.string().uuid(),
  notes: z.string().max(4000)
});

export async function updateLeadNotesAction(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const parsed = NotesSchema.safeParse({
    leadId: formData.get('leadId'),
    notes: formData.get('notes') ?? ''
  });
  if (!parsed.success) return;
  await db
    .update(leads)
    .set({ notes: parsed.data.notes.trim() || null })
    .where(eq(leads.id, parsed.data.leadId));
  revalidatePath('/dashboard/admin/leads');
}

const PasteSchema = z.object({
  urls: z.string().max(20_000)
});

/**
 * Operator pastes a list of URLs (one per line). We split, qualify
 * each through the same pipeline the CLI uses, and revalidate the
 * page. Sequential — the server-action timeout (60s on prod) gives
 * us ~30 leads per call before we need to chunk; the UI hint says
 * "up to 25 URLs per paste".
 */
export async function qualifyPastedUrlsAction(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const parsed = PasteSchema.safeParse({ urls: formData.get('urls') ?? '' });
  if (!parsed.success) return;

  const urls = parsed.data.urls
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (urls.length === 0) return;

  await qualifyBatch(urls, 'admin_paste');
  revalidatePath('/dashboard/admin/leads');
}

export async function deleteLeadAction(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = String(formData.get('leadId') ?? '');
  if (!id) return;
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath('/dashboard/admin/leads');
}
