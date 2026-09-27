---
status: acted
implemented: yes (Dev Center setup and listing pending)
last-verified: 2026-09-27
---

# Wix App Market — the app inside the Wix dashboard, billed by Wix

Counterpart of `SHOPIFY-APP-STORE.md`. The Wix connector itself (pull, apply,
product webhooks) is in `WIX-CONNECTOR.md`.

## Requirements this answers

| Wix guideline / check | How |
| --- | --- |
| Dashboard page extension (all OAuth apps) | `/wix` (own root layout), then the full app in the same frame |
| Identify users by `instanceId`, auto login | signed `instance` → our session token; `wix_instances` → account |
| Accepting payments: Wix Billing only, no CTA to other purchase paths | plans + packs through Wix checkout; Stripe blocked for `billing_channel = 'wix'` |
| No downgrade through the external pricing page | refused in `startWixCheckout`; the page links to Wix subscriptions |
| Credits bought in-app never expire | packs land in the `pack` bucket |
| App requires Wix Stores | onboarding warns when `installedWixApps` lacks it |
| `APP_SETUP_FINISHED` BI event | sent when a site is linked |
| Site duplication | a duplicate is a new instance: it registers and onboards like any install (client credentials need no refresh token) |
| No other platform named in the app | the embedded store tab shows only the Wix card; the Wix home names no other store |

## Flow

1. Wix loads the dashboard page `https://oneshoplab.com/wix?instance=<signed>`.
   `wixSessionFromInstance` checks the signature (app secret) and its age
   (≤ 1 h), then mints our session token (`entities/shop-connection`
   `wix-session-token.ts`: HS256, 2 h, issuer `oneshoplab:wix`). The page
   sends it as Bearer to `/api/wix/app/*` and renews it every 20 min.
2. `ensureWixInstall` registers the site from Get App Instance (name, host,
   owner email — needs **Read Site Owner Email**) in `wix_instances`, and
   reconnects a reinstalled, already-linked site.
3. Not linked yet: **Create my workspace** (`onboardWixSite`: account from the
   owner email, 150 credits, Terms consent, `billing_channel = 'wix'`) or
   **Link my account** (`/{locale}/wix-link?t=` in a new tab, 15-min token
   bound to Wix).
4. **Open OneShopLab**: the full app in the same frame,
   `/{locale}/dashboard/sites/{id}?osl_token=<token>`. The proxy turns the
   parameter into the request's Bearer; an inline script
   (`shared/embedded/wix-bridge.ts`, first in `<head>` when the host is Wix)
   adds it to every same-origin fetch — what App Bridge does for Shopify.
   Pages are scoped to the site exactly like Shopify (`enforceEmbeddedScope`).
5. The website's own "connect my Wix store" (external install flow) joins the
   same registry and the same billing rule.

## Billing

- Prices: `pricing.json` → `wixBilling` (USD). EUR × 1.1382 / 0.78, rounded up
  to .99: after year one Wix keeps 20 % + 2.5 %, and a price rise would only
  reach new customers, so the long-term cut is priced in from day one.
  Starter 58.99 / Pro 131.99 / Scale 291.99 a month, yearly −20 %; packs
  7.99 / 26.99 / 87.99 / 364.99.
- `wixBilling.productIds`: the plan GUIDs from the Wix app dashboard
  (Pricing). **null until created — a null plan cannot be bought.**
- Checkout: `POST /apps/v1/checkout` (plan GUID, MONTHLY / YEARLY /
  ONE_TIME), opened in a new tab, `successUrl` = the app in the Wix dashboard.
  Back on the page, the state is read again.
- Truth: `syncWixBilling` re-reads Get App Instance (running plan: GUID,
  cycle, purchase date = the purchase key) and the purchase history (every
  pack credited once, idempotency key = the purchase). Called on every home
  load, on the webhooks Paid Plan Purchased / Changed / Auto Renewal
  Cancelled, and by the refill tick.
- Credits: Stripe's rules (first plan sets the subscription bucket, upgrade
  adds the difference). Refills monthly (`refillWixSubscriptions`, worker)
  while the same purchase runs.
- Test purchases: before the listing is live Wix prices everything at 0.00.
  A 0.00 purchase activates the plan or pack but grants at most
  `shopifyBilling.testCreditCap` (500) credits per account, **shared with
  Shopify test charges** (`grantTestCredits`, `entities/credit`), never
  refilled. Set `WIX_APP_PUBLISHED=1` once listed (hides the test notice).
- Which store bills an account: `settleBillingChannel`
  (`entities/shop-connection`) — a running paid plan keeps its channel; else
  the store just installed, else an installed store, else Stripe. Uninstalling
  the last Wix site puts the account back on Stripe (or its Shopify shop).
- A plan runs on one site: a second, free Wix site of the same account never
  cancels it (its home says the plan is billed on another site).

## Dev Center setup (to do once)

1. **Extensions → Dashboard Page**: iFrame URL `https://oneshoplab.com/wix`,
   page name "OneShopLab", sidebar name "OneShopLab", hide the sidebar off.
2. **Permissions**: Wix Stores – Manage Products, Manage Your App, **Read Site
   Owner Email** (new).
3. **Webhooks** → `https://oneshoplab.com/api/webhooks/wix`: add App
   Instance → App Installed, Paid Plan Purchased, Paid Plan Changed, Paid Plan
   Auto Renewal Cancelled (App Removed and the product events are already
   there).
4. **Pricing**: business model Freemium; **Link to External Pricing Page**
   → `https://oneshoplab.com/wix/pricing` (read-only Wix prices; every
   purchase happens in the app, through Wix checkout); plans:
   - Starter / Pro / Scale — recurring, monthly + yearly (−20 %), prices above;
   - Boost / Power / Mega / Catalog packs — **Single** billing model.
   Send the 7 plan GUIDs → `pricing.json` `wixBilling.productIds`.
5. After approval: `.env` `WIX_APP_PUBLISHED=1`, restart.

## nginx

`scripts/ops/nginx/oneshoplab-embedded.conf`: framed documents may be framed
by `manage.wix.com` / `*.wix.com` too; App Bridge is injected only when the
request is neither `/wix` nor carries `osl_token`.

## Tests

`tests/unit/wix-app-market.test.ts` (session token, host routing, link
tokens, webhook classification, price rules),
`tests/db/wix-app-market.test.ts` (session, registry, onboarding, linking,
checkout, plans, upgrades, downgrades, test cap, packs, refills, uninstall,
Stripe guard, webhooks), `tests/db/wix-connector.test.ts` (website install
joins the registry).
