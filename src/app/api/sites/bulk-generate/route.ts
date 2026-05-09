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
  estimateBulkCost,
  getActiveBulkJob,
  listBulkCandidates,
  startBulkSiteGenerate
} from '@/lib/bulk/site-generate';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';

/**
 * Start a bulk catalog generation for a site. Plan-gated to Scale only.
 * Pre-flight checks: ownership, no other bulk in flight, sufficient
 * credit balance covers the projected total. The actual work is done
 * by the worker via processNextBulkProduct() — this route returns as
 * soon as the parent job row is inserted.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Plan gate. The Scale tier is the only one that exposes bulk in
  // the marketing copy and the only one we honour here — undercutting
  // it would break the differentiator.
  const plan = (session.user.plan ?? 'free') as string;
  if (plan !== 'scale') {
    return NextResponse.json({ error: 'plan_not_eligible' }, { status: 403 });
  }

  let body: {
    siteId?: unknown;
    chatModelId?: unknown;
    imageQualityId?: unknown;
    customInstructions?: unknown;
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

  const inFlight = await getActiveBulkJob(project.id);
  if (inFlight) {
    return NextResponse.json(
      { error: 'bulk_already_running', jobId: inFlight.id },
      { status: 409 }
    );
  }

  const candidates = await listBulkCandidates(project.id);
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'no_products' }, { status: 400 });
  }

  const chatModelId: ChatModelId =
    typeof body.chatModelId === 'string' && body.chatModelId in CHAT_MODEL_REGISTRY
      ? (body.chatModelId as ChatModelId)
      : (session.user.preferredChatModel as ChatModelId | undefined) ??
        DEFAULT_CHAT_MODEL;
  const imageQualityId: ImageQualityId =
    typeof body.imageQualityId === 'string' &&
    body.imageQualityId in IMAGE_MODEL_REGISTRY
      ? (body.imageQualityId as ImageQualityId)
      : (session.user.preferredImageQuality as ImageQualityId | undefined) ??
        DEFAULT_IMAGE_QUALITY;
  const customInstructions =
    typeof body.customInstructions === 'string'
      ? body.customInstructions.slice(0, 750)
      : '';

  const total = estimateBulkCost(candidates.length, chatModelId, imageQualityId);
  if ((session.user.creditsBalance ?? 0) < total) {
    return NextResponse.json(
      { error: 'insufficient_credits', required: total },
      { status: 402 }
    );
  }

  const productIds = candidates.map((c) => c.id);
  const id = await startBulkSiteGenerate({
    projectId: project.id,
    productIds,
    chatModelId,
    imageQualityId,
    customInstructions,
    totalCreditsBudget: total
  });

  return NextResponse.json({
    ok: true,
    jobId: id,
    productCount: productIds.length,
    totalCreditsBudget: total
  });
}

/**
 * Poll endpoint — returns the current bulk job's progress for the
 * dashboard banner.
 */
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

  const active = await getActiveBulkJob(project.id);
  return NextResponse.json({ active });
}
