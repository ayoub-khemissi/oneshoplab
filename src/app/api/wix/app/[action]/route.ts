import { CREDIT_PACK_IDS, type CreditPackId } from '@/entities/ai-model';
import { bearerFrom, requestPull } from '@/entities/shop-connection';
import {
  authenticateWixEmbedded,
  createWixLinkToken,
  ensureWixInstall,
  loadWixEmbeddedState,
  onboardWixSite,
  renewWixSession,
  startWixCheckout,
  type WixInstall
} from '@/features/wix-connector';
import { routing } from '@/i18n/routing';
import { take } from '@/shared/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Wix dashboard page's backend. Every call carries our session token
 * (Authorization: Bearer), minted from the signed `instance` Wix gave the
 * page — the dashboard iframe has no cookie of ours.
 */
const ACTION_BUCKET = { capacity: 20, refillPerSec: 1 / 3 };
const PAID_PLANS = ['starter', 'pro', 'scale'] as const;

function appUrl(): string {
  return (process.env.APP_URL ?? '').replace(/\/+$/, '');
}

function localeOf(raw: unknown): string {
  const l = String(raw ?? '')
    .slice(0, 2)
    .toLowerCase();
  return (routing.locales as readonly string[]).includes(l) ? l : routing.defaultLocale;
}

type Authed = { ok: true; install: WixInstall } | { ok: false; response: Response };

async function authed(req: Request): Promise<Authed> {
  const auth = authenticateWixEmbedded(bearerFrom(req.headers));
  if (!auth.ok) {
    return { ok: false, response: Response.json({ error: auth.error }, { status: auth.status }) };
  }
  try {
    return { ok: true, install: await ensureWixInstall(auth.instanceId) };
  } catch (e) {
    console.error('[wix app] install', auth.instanceId, e instanceof Error ? e.message : e);
    return { ok: false, response: Response.json({ error: 'install_failed' }, { status: 502 }) };
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ action: string }> }
): Promise<Response> {
  const { action } = await params;
  if (action !== 'state') return Response.json({ error: 'not_found' }, { status: 404 });
  const a = await authed(req);
  if (!a.ok) return a.response;
  return Response.json(await loadWixEmbeddedState(a.install));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> }
): Promise<Response> {
  const { action } = await params;
  // Renewing the session needs no Wix call: only a valid current token.
  if (action === 'session') {
    const auth = authenticateWixEmbedded(bearerFrom(req.headers));
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    return Response.json({ token: renewWixSession(auth.instanceId) });
  }
  const a = await authed(req);
  if (!a.ok) return a.response;
  const { row } = a.install;
  if (!take(`wix-app:${row.instanceId}`, ACTION_BUCKET).ok) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    body = {};
  }

  switch (action) {
    case 'onboard': {
      const res = await onboardWixSite(row.instanceId, { locale: localeOf(body.locale) });
      if (!res.ok) return Response.json({ error: res.reason }, { status: 409 });
      return Response.json({ ok: true });
    }
    case 'link': {
      const token = createWixLinkToken(row.instanceId);
      return Response.json({
        url: `${appUrl()}/${localeOf(body.locale)}/wix-link?t=${encodeURIComponent(token)}`
      });
    }
    case 'sync': {
      if (!row.projectId) return Response.json({ error: 'not_linked' }, { status: 409 });
      await requestPull(row.projectId);
      return Response.json({ ok: true });
    }
    case 'subscribe': {
      const plan = String(body.plan ?? '');
      const cycle = body.cycle === 'yearly' ? 'yearly' : 'monthly';
      if (!(PAID_PLANS as readonly string[]).includes(plan)) {
        return Response.json({ error: 'bad_plan' }, { status: 400 });
      }
      const res = await startWixCheckout(row.instanceId, {
        kind: 'plan',
        plan: plan as (typeof PAID_PLANS)[number],
        cycle
      });
      return res.ok
        ? Response.json({ checkoutUrl: res.checkoutUrl })
        : Response.json({ error: res.reason }, { status: 409 });
    }
    case 'purchase': {
      const pack = String(body.pack ?? '');
      if (!(CREDIT_PACK_IDS as readonly string[]).includes(pack)) {
        return Response.json({ error: 'bad_pack' }, { status: 400 });
      }
      const res = await startWixCheckout(row.instanceId, {
        kind: 'pack',
        pack: pack as CreditPackId
      });
      return res.ok
        ? Response.json({ checkoutUrl: res.checkoutUrl })
        : Response.json({ error: res.reason }, { status: 409 });
    }
    default:
      return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
