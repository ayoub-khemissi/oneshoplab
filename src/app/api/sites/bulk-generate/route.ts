import { resolveChatModelId } from '@/entities/ai-model';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CHAT_MODEL_REGISTRY,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  type ChatModelId,
  type ImageQualityId
} from '@/entities/ai-model';
import { z } from 'zod';
import {
  cancelBulkJob,
  estimateBulkCostBreakdown,
  getActiveBulkJob,
  getEffectiveBulkPrefs,
  getLatestBulkJobDetail,
  listBulkCandidatesWithStatus,
  resolveBulkPrefs,
  retryFailedFromBulk,
  startBulkSiteGenerate
} from '@/features/bulk-generate';
import { auth } from '@/entities/user';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

/**
 * Bulk catalog generation endpoint.
 *
 *   POST   — start a bulk for the site (Scale plan only). Body must
 *            include productIds (the merchant-selected subset). Server
 *            re-validates ownership + the budget against current
 *            preferences. The per-field "skip already-generated"
 *            behaviour lives in the worker, not here, so this only
 *            checks ceilings.
 *   GET    — returns: candidates with per-product pending fields +
 *            cost; the live cost estimate; the latest bulk detail for
 *            the post-completion banner; current credit balance; user
 *            plan.
 *   DELETE — cancel the active bulk for a site. Optional ?retryFailed=
 *            triggers retryFailedFromBulk against the latest bulk.
 */

/**
 * Resolve the models to use: an explicit, validated client override
 * (the modal's picker, mirroring the product page) wins; otherwise the
 * account preference; otherwise the default. The modal also persists
 * its pick to the account, but we never depend on session freshness —
 * the chosen ids travel with the request like the product flow.
 */
function resolveModels(
  session: {
    user?: {
      preferredChatModel?: string | null;
      preferredImageQuality?: string | null;
    } | null;
  },
  overrideChat?: string | null,
  overrideImage?: string | null
): {
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
} {
  const chatModelId: ChatModelId =
    overrideChat && overrideChat in CHAT_MODEL_REGISTRY
      ? (overrideChat as ChatModelId)
      : resolveChatModelId(session.user?.preferredChatModel);
  const imageQualityId: ImageQualityId =
    overrideImage && overrideImage in IMAGE_MODEL_REGISTRY
      ? (overrideImage as ImageQualityId)
      : session.user?.preferredImageQuality &&
          session.user.preferredImageQuality in IMAGE_MODEL_REGISTRY
        ? (session.user.preferredImageQuality as ImageQualityId)
        : DEFAULT_IMAGE_QUALITY;
  return { chatModelId, imageQualityId };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Bulk catalog generation is available from the Pro plan upwards.
  // Free / Starter need to upgrade — the UI hides the CTA for them.
  const plan = (session.user.plan ?? 'free') as string;
  if (plan !== 'pro' && plan !== 'scale') {
    return NextResponse.json({ error: 'plan_not_eligible' }, { status: 403 });
  }

  let body: {
    siteId?: unknown;
    productIds?: unknown;
    customInstructions?: unknown;
    /** Model picker overrides (validated server-side). */
    chatModelId?: unknown;
    imageQualityId?: unknown;
    /** When provided, the server clones the prior bulk's failed-product
     *  set instead of taking productIds from the body. Mutually
     *  exclusive with productIds (retryFromBulkId wins). */
    retryFromBulkId?: unknown;
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : '';
  if (!siteId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id))
  });
  if (!project) {
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  // Effective prefs (site override → account default → legacy).
  // Snapshotted into the bulk job so a running job is deterministic.
  const { prefs } = await getEffectiveBulkPrefs(project.id);
  if (
    !prefs.fields.title &&
    !prefs.fields.description &&
    !prefs.fields.tags &&
    !prefs.fields.images
  ) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 });
  }

  const { chatModelId, imageQualityId } = resolveModels(
    session,
    typeof body.chatModelId === 'string' ? body.chatModelId : null,
    typeof body.imageQualityId === 'string' ? body.imageQualityId : null
  );
  const customInstructions =
    typeof body.customInstructions === 'string' ? body.customInstructions.slice(0, 750) : '';

  // Retry-failed branch — clones a previous bulk's failed productIds
  // and queues a new run. The worker's per-field skip means succeeded
  // fields aren't re-billed.
  if (typeof body.retryFromBulkId === 'string' && body.retryFromBulkId) {
    const candidates = await listBulkCandidatesWithStatus(project.id, chatModelId, imageQualityId);
    const total = candidates.reduce((sum, c) => sum + c.pendingCost, 0);
    if ((session.user.creditsBalance ?? 0) < total) {
      return NextResponse.json({ error: 'insufficient_credits', required: total }, { status: 402 });
    }
    const out = await retryFailedFromBulk({
      projectId: project.id,
      sourceJobId: body.retryFromBulkId,
      chatModelId,
      imageQualityId,
      customInstructions,
      totalCreditsBudget: total
    });
    if (!out.ok) {
      const code =
        out.reason === 'already_running' ? 409 : out.reason === 'source_not_found' ? 404 : 400;
      return NextResponse.json({ error: out.reason }, { status: code });
    }
    return NextResponse.json({
      ok: true,
      jobId: out.jobId,
      productCount: out.productCount
    });
  }

  // Fresh-bulk branch — body.productIds is the merchant's explicit
  // selection. We always use the candidates list from the DB to
  // intersect (so a stale client can't queue a generation for an
  // archived or already-fully-generated product), and re-derive cost
  // from the resulting set.
  const requestedIds = Array.isArray(body.productIds)
    ? (body.productIds.filter((s): s is string => typeof s === 'string') as string[])
    : null;

  const candidates = await listBulkCandidatesWithStatus(project.id, chatModelId, imageQualityId);
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'no_products' }, { status: 400 });
  }
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  // No selection passed = backward-compat path: take everything.
  // With selection = filter to the intersection.
  const selected =
    requestedIds === null ? candidates : candidates.filter((c) => requestedIds.includes(c.id));
  if (selected.length === 0) {
    return NextResponse.json({ error: 'no_products' }, { status: 400 });
  }

  const totalCost = selected.reduce((sum, c) => sum + c.pendingCost, 0);
  if ((session.user.creditsBalance ?? 0) < totalCost) {
    return NextResponse.json(
      { error: 'insufficient_credits', required: totalCost },
      { status: 402 }
    );
  }

  // Final defensive check — make sure every requested id is a real
  // candidate (catches a forged body that smuggled in an archived
  // product id or a product from another site).
  if (requestedIds) {
    for (const id of requestedIds) {
      if (!candidateMap.has(id)) {
        return NextResponse.json({ error: 'invalid_selection' }, { status: 400 });
      }
    }
  }

  const result = await startBulkSiteGenerate({
    projectId: project.id,
    productIds: selected.map((c) => c.id),
    chatModelId,
    imageQualityId,
    customInstructions,
    totalCreditsBudget: totalCost,
    prefs
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'bulk_already_running' }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    productCount: selected.length,
    totalCreditsBudget: totalCost
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId') ?? '';
  if (!siteId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id))
  });
  if (!project) {
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  const { chatModelId, imageQualityId } = resolveModels(
    session,
    url.searchParams.get('chat'),
    url.searchParams.get('img')
  );
  const { prefs, siteOverride } = await getEffectiveBulkPrefs(project.id);
  const allCandidates = await listBulkCandidatesWithStatus(project.id, chatModelId, imageQualityId);
  // Server-side title search (debounced from the modal). The cost
  // estimate stays on the FULL set — it represents the whole catalog,
  // not the current search view.
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const candidates = q
    ? allCandidates.filter((c) => c.title.toLowerCase().includes(q))
    : allCandidates;
  const breakdown = estimateBulkCostBreakdown(
    allCandidates.length,
    chatModelId,
    imageQualityId,
    prefs
  );

  const active = await getActiveBulkJob(project.id);
  const detail = await getLatestBulkJobDetail(project.id);

  return NextResponse.json({
    active,
    detail,
    estimate: breakdown,
    candidates,
    prefs,
    siteOverride,
    creditsBalance: session.user.creditsBalance ?? 0,
    plan: (session.user.plan ?? 'free') as string
  });
}

const PrefsSchema = z.union([
  z.object({ siteId: z.string().min(1), reset: z.literal(true) }),
  z.object({
    siteId: z.string().min(1),
    fields: z.object({
      title: z.boolean(),
      description: z.boolean(),
      tags: z.boolean(),
      images: z.boolean()
    }),
    imageAngles: z.array(z.enum(['lifestyle', 'studio', 'inuse'])).max(3)
  })
]);

/**
 * Save the site's bulk-generation preferences. Owner-checked, validated.
 * Returns the resolved prefs so the client can re-hydrate from the
 * canonical (sanitized) shape.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Bulk config only matters for plans that can run a bulk. Defense in
  // depth — the UI already hides the panel for free/starter.
  const plan = (session.user.plan ?? 'free') as string;
  if (plan !== 'pro' && plan !== 'scale') {
    return NextResponse.json({ error: 'plan_not_eligible' }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = PrefsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const data = parsed.data;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, data.siteId), eq(projects.userId, session.user.id)),
    columns: { id: true }
  });
  if (!project) {
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  if ('reset' in data) {
    // Clear the site override → the site inherits the account default.
    await db.update(projects).set({ bulkPrefs: null }).where(eq(projects.id, project.id));
  } else {
    // resolveBulkPrefs sanitizes (e.g. images on + zero angles → all 3),
    // so we persist the canonical shape.
    const resolved = resolveBulkPrefs({
      fields: data.fields,
      imageAngles: data.imageAngles
    });
    await db.update(projects).set({ bulkPrefs: resolved }).where(eq(projects.id, project.id));
  }

  // Echo the now-effective prefs (post-reset this is the account
  // default / legacy) + override state so the client re-syncs.
  const { prefs, siteOverride } = await getEffectiveBulkPrefs(project.id);
  return NextResponse.json({ ok: true, prefs, siteOverride });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId') ?? '';
  const jobId = url.searchParams.get('jobId') ?? '';
  if (!siteId || !jobId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, siteId), eq(projects.userId, session.user.id))
  });
  if (!project) {
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  await cancelBulkJob(jobId, project.id);
  return NextResponse.json({ ok: true });
}
