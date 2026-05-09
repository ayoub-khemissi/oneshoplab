import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CHAT_MODEL_REGISTRY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_REGISTRY,
  type ChatModelId,
  type ImageQualityId
} from '@/lib/ai';
import {
  cancelBulkJob,
  estimateBulkCostBreakdown,
  getActiveBulkJob,
  getLatestBulkJobDetail,
  listBulkCandidates,
  startBulkSiteGenerate
} from '@/lib/bulk/site-generate';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

/**
 * Bulk catalog generation endpoint.
 *
 *   POST   — start a bulk for the site (Scale plan only). Atomic
 *            against double-click via DB transaction in
 *            startBulkSiteGenerate(); returns 409 if a bulk is already
 *            running for the same site.
 *   GET    — returns the merchant's current cost estimate (computed
 *            from their LIVE preferred chat model + image quality so
 *            the modal never shows a stale number) plus the latest
 *            bulk job detail so the UI can render the active progress
 *            and the post-completion failure breakdown.
 *   DELETE — cancel the active bulk for a site.
 */

function resolveModels(session: {
  user?: {
    preferredChatModel?: string | null;
    preferredImageQuality?: string | null;
  } | null;
}): {
  chatModelId: ChatModelId;
  imageQualityId: ImageQualityId;
} {
  const chatModelId: ChatModelId =
    session.user?.preferredChatModel &&
    session.user.preferredChatModel in CHAT_MODEL_REGISTRY
      ? (session.user.preferredChatModel as ChatModelId)
      : DEFAULT_CHAT_MODEL;
  const imageQualityId: ImageQualityId =
    session.user?.preferredImageQuality &&
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

  const plan = (session.user.plan ?? 'free') as string;
  if (plan !== 'scale') {
    return NextResponse.json({ error: 'plan_not_eligible' }, { status: 403 });
  }

  let body: { siteId?: unknown; customInstructions?: unknown };
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

  const candidates = await listBulkCandidates(project.id);
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'no_products' }, { status: 400 });
  }

  const { chatModelId, imageQualityId } = resolveModels(session);
  const breakdown = estimateBulkCostBreakdown(
    candidates.length,
    chatModelId,
    imageQualityId
  );

  if ((session.user.creditsBalance ?? 0) < breakdown.total) {
    return NextResponse.json(
      { error: 'insufficient_credits', required: breakdown.total },
      { status: 402 }
    );
  }

  const customInstructions =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.slice(0, 750)
      : '';

  const productIds = candidates.map((c) => c.id);
  const result = await startBulkSiteGenerate({
    projectId: project.id,
    productIds,
    chatModelId,
    imageQualityId,
    customInstructions,
    totalCreditsBudget: breakdown.total
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'bulk_already_running' },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    productCount: productIds.length,
    totalCreditsBudget: breakdown.total
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

  // Fresh cost estimate from the merchant's LIVE preferences. Avoids
  // the stale-snapshot trap where the dashboard SSR picked one model
  // but the user changed it in another tab.
  const candidates = await listBulkCandidates(project.id);
  const { chatModelId, imageQualityId } = resolveModels(session);
  const breakdown = estimateBulkCostBreakdown(
    candidates.length,
    chatModelId,
    imageQualityId
  );

  const active = await getActiveBulkJob(project.id);
  const detail = await getLatestBulkJobDetail(project.id);

  return NextResponse.json({
    active,
    detail,
    estimate: breakdown,
    creditsBalance: session.user.creditsBalance ?? 0,
    plan: (session.user.plan ?? 'free') as string
  });
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
