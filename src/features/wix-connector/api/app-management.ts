/**
 * Wix App Management calls for one site (app instance): who installed the
 * app and on which plan, Wix checkout links, purchase history, and the
 * "setup finished" signal. All go through the site's client-credentials
 * client — no extra permission beyond "Manage Your App", except the owner's
 * email (READ SITE OWNER EMAIL).
 */
import type { WixClient } from './client';

export type WixPaymentCycle =
  | 'NO_CYCLE'
  | 'MONTHLY'
  | 'YEARLY'
  | 'ONE_TIME'
  | 'TWO_YEARS'
  | 'THREE_YEARS'
  | 'FOUR_YEARS'
  | 'FIVE_YEARS';

export interface WixAppInstance {
  instanceId: string;
  isFree: boolean;
  billing: {
    /** The plan bought — Wix sends the plan GUID here (vendor product id). */
    packageName: string | null;
    billingCycle: WixPaymentCycle | null;
    /** Purchase date of the current plan: stays the same across renewals. */
    timeStamp: string | null;
    expirationDate: string | null;
    autoRenewing: boolean;
    invoiceId: string | null;
  } | null;
  originInstanceId: string | null;
  site: {
    siteDisplayName: string | null;
    url: string | null;
    locale: string | null;
    ownerEmail: string | null;
    installedWixApps: string[];
  };
}

export interface WixPurchase {
  productId: string;
  price: number;
  currency: string | null;
  billingCycle: WixPaymentCycle | null;
  dateCreated: string;
}

interface RawInstance {
  instance?: {
    instanceId?: string;
    isFree?: boolean;
    billing?: {
      packageName?: string;
      billingCycle?: WixPaymentCycle;
      timeStamp?: string;
      expirationDate?: string;
      autoRenewing?: boolean;
      invoiceId?: string;
    } | null;
    originInstanceId?: string;
  };
  site?: {
    siteDisplayName?: string;
    url?: string;
    locale?: string;
    ownerInfo?: { email?: string } | null;
    installedWixApps?: string[];
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** `GET /apps/v1/instance`. Null when Wix no longer knows the instance. */
export async function getAppInstance(client: WixClient): Promise<WixAppInstance | null> {
  const d = await client.request<RawInstance | null>('/apps/v1/instance');
  const i = d?.instance;
  if (!i?.instanceId) return null;
  const b = i.billing;
  return {
    instanceId: i.instanceId,
    isFree: i.isFree !== false,
    billing:
      i.isFree === false && b
        ? {
            packageName: str(b.packageName),
            billingCycle: b.billingCycle ?? null,
            timeStamp: str(b.timeStamp),
            expirationDate: str(b.expirationDate),
            autoRenewing: b.autoRenewing === true,
            invoiceId: str(b.invoiceId)
          }
        : null,
    originInstanceId: str(i.originInstanceId),
    site: {
      siteDisplayName: str(d?.site?.siteDisplayName),
      url: str(d?.site?.url),
      locale: str(d?.site?.locale),
      ownerEmail: str(d?.site?.ownerInfo?.email),
      installedWixApps: Array.isArray(d?.site?.installedWixApps) ? d.site.installedWixApps : []
    }
  };
}

/** `POST /apps/v1/checkout`: a Wix checkout link (valid 48 h) for one plan GUID. */
export async function getCheckoutUrl(
  client: WixClient,
  input: { productId: string; billingCycle: WixPaymentCycle; successUrl: string }
): Promise<string> {
  const d = await client.request<{ checkoutUrl?: string } | null>('/apps/v1/checkout', {
    method: 'POST',
    body: input
  });
  if (!d?.checkoutUrl) throw new Error('Wix returned no checkout URL');
  return d.checkoutUrl;
}

/** `GET /apps/v1/checkout/history`: every purchase on this site, oldest first. */
export async function getPurchaseHistory(client: WixClient): Promise<WixPurchase[]> {
  const d = await client.request<{
    purchases?: Array<{
      productId?: string;
      price?: string;
      currency?: string;
      billingCycle?: WixPaymentCycle;
      dateCreated?: string;
    }>;
  } | null>('/apps/v1/checkout/history');
  return (d?.purchases ?? [])
    .filter((p) => p.productId && p.dateCreated)
    .map((p) => ({
      productId: p.productId!,
      price: Number.parseFloat(p.price ?? '0') || 0,
      currency: str(p.currency),
      billingCycle: p.billingCycle ?? null,
      dateCreated: p.dateCreated!
    }))
    .sort((a, b) => a.dateCreated.localeCompare(b.dateCreated));
}

/** Tells Wix the merchant finished onboarding (App Market analytics). */
export async function sendSetupFinished(client: WixClient): Promise<void> {
  await client.request('/apps/v1/bi-event', {
    method: 'POST',
    body: { eventName: 'APP_SETUP_FINISHED' }
  });
}
