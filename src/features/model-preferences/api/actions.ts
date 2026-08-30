'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { CHAT_MODEL_IDS as ACTIVE_CHAT_MODEL_IDS } from '@/entities/ai-model';
import { auth } from '@/entities/user';
import { db } from '@/shared/db';
import {
  IMAGE_QUALITY_IDS,
  users,
  type ChatModelDbId,
  type ImageQualityDbId
} from '@/shared/db/schema';

/**
 * Update the current user's model preferences. Account-wide — applies to all
 * future generations across all projects. Called from the account preferences
 * page and from the inline selectors on the dashboard product page.
 */
export async function updateUserPreferencesAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const chatModelRaw = String(formData.get('chatModel') ?? '');
  const imageQualityRaw = String(formData.get('imageQuality') ?? '');

  const updates: {
    preferredChatModel?: ChatModelDbId;
    preferredImageQuality?: ImageQualityDbId;
  } = {};

  if ((ACTIVE_CHAT_MODEL_IDS as readonly string[]).includes(chatModelRaw)) {
    updates.preferredChatModel = chatModelRaw as ChatModelDbId;
  }
  if ((IMAGE_QUALITY_IDS as readonly string[]).includes(imageQualityRaw)) {
    updates.preferredImageQuality = imageQualityRaw as ImageQualityDbId;
  }

  if (Object.keys(updates).length === 0) return;

  await db.update(users).set(updates).where(eq(users.id, session.user.id));

  // Refresh any view that surfaces the prefs (header, product page, etc).
  revalidatePath('/dashboard', 'layout');
  revalidatePath('/account/preferences');
}
