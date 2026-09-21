'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { IMAGE_FORMAT_IDS } from '@/entities/ai-model';
import { auth } from '@/entities/user';
import { resolveBulkPrefs } from '../model/types';
import { db } from '@/shared/db';
import { users } from '@/shared/db/schema';

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
    imageAngles: z.array(z.enum(['packshot', 'inuse', 'lifestyle', 'studio'])).max(3),
    /** Optional so a client that predates formats still validates. */
    imageFormat: z.enum(IMAGE_FORMAT_IDS).optional(),
    transparentPackshot: z.boolean().optional()
  })
]);

export async function updateUserDefaultBulkPrefsAction(formData: FormData): Promise<void> {
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
          imageAngles: parsed.data.imageAngles,
          imageFormat: parsed.data.imageFormat,
          transparentPackshot: parsed.data.transparentPackshot
        });

  await db.update(users).set({ defaultBulkPrefs: value }).where(eq(users.id, session.user.id));

  revalidatePath('/account/preferences');
}
