import { randomUUID } from 'node:crypto';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { SIGNUP_FREE_CREDITS } from '@/entities/ai-model';
import { applyCreditTransaction } from '@/entities/credit';
import { LEGAL_TERMS_VERSION } from '@/entities/legal-consent';
import { db } from '@/shared/db';
import {
  audits,
  legalConsents,
  productChanges,
  products,
  projects,
  users,
  type BillingChannel,
  type Platform
} from '@/shared/db/schema';
import { getConnection } from './connections';

export async function emailTaken(email: string | null): Promise<boolean> {
  if (!email) return false;
  const u = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
  return Boolean(u);
}

/**
 * "Create my workspace" inside a store admin: the account is created from the
 * store (owner email, store name), billed by that store from now on, with the
 * same welcome credits and the same recorded Terms consent as a web signup —
 * the merchant clicked a button that states it.
 */
export async function createAccountFromStore(input: {
  email: string;
  name: string | null;
  locale: string | null;
  billingChannel: Exclude<BillingChannel, 'stripe'>;
}): Promise<string> {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email: input.email.toLowerCase().trim(),
    name: input.name?.trim() || null,
    plan: 'free',
    billingChannel: input.billingChannel,
    locale: input.locale
  });
  await applyCreditTransaction({
    userId,
    delta: SIGNUP_FREE_CREDITS,
    bucket: 'pack',
    reason: 'signup_grant',
    idempotencyKey: `grant-signup-${userId}`
  });
  await db.insert(legalConsents).values({
    id: randomUUID(),
    userId,
    kind: 'signup_tos',
    version: LEGAL_TERMS_VERSION,
    source: `user:${userId}`,
    locale: input.locale
  });
  return userId;
}

/** The user's site for this store, found by its domains or created. */
export async function projectForStore(
  userId: string,
  store: { domains: Array<string | null>; name: string | null; source: Platform }
): Promise<string> {
  const domains = store.domains.filter((d): d is string => Boolean(d));
  for (const d of domains) {
    const found = await db.query.projects.findFirst({
      where: and(eq(projects.userId, userId), eq(projects.domain, d))
    });
    if (found) return found.id;
  }
  const domain = domains[0] ?? null;
  const id = randomUUID();
  await db.insert(projects).values({
    id,
    userId,
    name: store.name?.trim() || domain || 'My store',
    domain,
    url: domain ? `https://${domain}` : null,
    source: store.source
  });
  return id;
}

/** What the embedded home shows once the store is linked. */
export interface StoreSummary {
  projectName: string | null;
  billingChannel: BillingChannel;
  plan: string;
  cycle: string | null;
  subscriptionStatus: string | null;
  currentPeriodEndIso: string | null;
  credits: number;
  products: number;
  lastPullAtIso: string | null;
  pulling: boolean;
  score: number | null;
  pendingChanges: number;
}

export async function loadStoreSummary(userId: string, projectId: string): Promise<StoreSummary> {
  const [user, project, connection, sub] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.projects.findFirst({ where: eq(projects.id, projectId) }),
    getConnection(projectId),
    db.query.subscriptions.findFirst({ where: (s, { eq: e }) => e(s.userId, userId) })
  ]);
  const [[productCount], [pending], latest] = await Promise.all([
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.projectId, projectId), eq(products.status, 'active'))),
    db
      .select({ n: count() })
      .from(productChanges)
      .where(and(eq(productChanges.projectId, projectId), eq(productChanges.status, 'pending'))),
    db.query.audits.findFirst({
      where: and(
        eq(audits.projectId, projectId),
        eq(audits.status, 'completed'),
        isNotNull(audits.scores)
      ),
      orderBy: (a, { desc }) => [desc(a.createdAt)]
    })
  ]);
  const overall = (latest?.scores as { overall?: number } | null)?.overall;
  return {
    projectName: project?.name ?? null,
    billingChannel: user?.billingChannel ?? 'stripe',
    plan: user?.plan ?? 'free',
    cycle: sub?.billingCycle ?? null,
    subscriptionStatus: sub?.status ?? null,
    currentPeriodEndIso: sub?.currentPeriodEnd?.toISOString() ?? null,
    credits: user?.creditsBalance ?? 0,
    products: productCount?.n ?? 0,
    lastPullAtIso: connection?.lastPullAt?.toISOString() ?? null,
    pulling: Boolean(connection?.pullRequestedAt) || connection?.pullProgress?.phase === 'running',
    score: typeof overall === 'number' ? overall : null,
    pendingChanges: pending?.n ?? 0
  };
}
