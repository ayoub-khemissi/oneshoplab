'use server';

import { z } from 'zod';
import { auth } from '@/entities/user';
import { setAutoApply } from './auto-send';

const uuid = z.string().uuid();

/** Toggle "send changes automatically" for one store. Owner only. */
export async function setAutoApplyAction(
  projectId: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const id = uuid.safeParse(projectId);
  if (!id.success) return { ok: false };
  return { ok: await setAutoApply(id.data, session.user.id, enabled) };
}
