import { requestPull } from '@/entities/shop-connection';
import {
  authenticateEmbedded,
  bearerFrom,
  cancelShopifySubscription,
  createShopLinkToken,
  ensureEmbeddedInstall,
  loadEmbeddedState,
  onboardShopifyShop,
  startShopifyPackPurchase,
  startShopifySubscription
} from '@/features/shopify-connector';
import { CREDIT_PACK_IDS, type CreditPackId } from '@/entities/ai-model';
import { take } from '@/shared/api';
import { routing } from '@/i18n/routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The embedded app's backend. Every call is authenticated by the Shopify ID
 * token App Bridge attaches (Authorization: Bearer) — the admin iframe has no
 * cookie of ours, by design (App Store requirement 1.1.1).
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

type Authed =
  | { ok: true; row: Awaited<ReturnType<typeof ensureEmbeddedInstall>> }
  | { ok: false; response: Response };

async function authed(req: Request): Promise<Authed> {
  const auth = authenticateEmbedded(bearerFrom(req.headers));
  if (!auth.ok) {
    return { ok: false, response: Response.json({ error: auth.error }, { status: auth.status }) };
  }
  try {
    return { ok: true, row: await ensureEmbeddedInstall(auth) };
  } catch (e) {
    console.error('[shopify app] install', auth.shop, e instanceof Error ? e.message : e);
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
  return Response.json(await loadEmbeddedState(a.row));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> }
): Promise<Response> {
  const { action } = await params;
  const a = await authed(req);
  if (!a.ok) return a.response;
  const { row } = a;
  if (!take(`shopify-app:${row.shopDomain}`, ACTION_BUCKET).ok) {
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
      const res = await onboardShopifyShop(row.shopDomain, { locale: localeOf(body.locale) });
      if (!res.ok) return Response.json({ error: res.reason }, { status: 409 });
      return Response.json({ ok: true });
    }
    case 'link': {
      const token = createShopLinkToken(row.shopDomain);
      return Response.json({
        url: `${appUrl()}/${localeOf(body.locale)}/shopify-link?t=${encodeURIComponent(token)}`
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
      const res = await startShopifySubscription(
        row.shopDomain,
        plan as (typeof PAID_PLANS)[number],
        cycle
      );
      return res.ok
        ? Response.json({ confirmationUrl: res.confirmationUrl })
        : Response.json({ error: res.reason }, { status: 409 });
    }
    case 'purchase': {
      const pack = String(body.pack ?? '');
      if (!(CREDIT_PACK_IDS as readonly string[]).includes(pack)) {
        return Response.json({ error: 'bad_pack' }, { status: 400 });
      }
      const res = await startShopifyPackPurchase(row.shopDomain, pack as CreditPackId);
      return res.ok
        ? Response.json({ confirmationUrl: res.confirmationUrl })
        : Response.json({ error: res.reason }, { status: 409 });
    }
    case 'cancel': {
      const res = await cancelShopifySubscription(row.shopDomain);
      return res.ok
        ? Response.json({ ok: true })
        : Response.json({ error: res.error }, { status: 409 });
    }
    default:
      return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
