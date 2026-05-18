'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { resolveBulkPrefs } from '@/lib/bulk/site-generate';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Persist the account-wide DEFAULT bulk-generation prefs (users.
 * defaultBulkPrefs). Sites without their own prefs inherit this. Gated
 * to pro/scale (the only plans that can bulk); the UI shows an upgrade
 * CTA instead for others. `reset` clears it back to the legacy default.
 */
const Schema = z.union([
  z.object({ reset: z.literal(true) }),
  z.object({
    fields: z.object({
      title: z.boolean(),
      description: z.boolean(),
      tags: z.boolean(),
      images: z.boolean()
    }),
    imageAngles: z.array(z.enum(['lifestyle', 'studio', 'inuse'])).max(3)
  })
]);

export async function updateUserDefaultBulkPrefsAction(
  formData: FormData
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const plan = (session.user.plan ?? 'free') as string;
  if (plan !== 'pro' && plan !== 'scale') return;

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('prefs') ?? ''));
  } catch {
    return;
  }
  const parsed = Schema.safeParse(payload);
  if (!parsed.success) return;

  const value =
    'reset' in parsed.data
      ? null
      : resolveBulkPrefs({
          fields: parsed.data.fields,
          imageAngles: parsed.data.imageAngles
        });

  await db
    .update(users)
    .set({ defaultBulkPrefs: value })
    .where(eq(users.id, session.user.id));

  revalidatePath('/account/preferences');
}
