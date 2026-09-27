# Shopify App Store — embedded app + Shopify Billing

Status: implemented 2026-09-27. Listing not yet submitted. Complements
`SHOPIFY-CONNECTOR.md` (catalog pull, webhooks, apply), which is unchanged:
an App Store install ends up as the same `shop_connections` row
(`authMode: 'oauth'`) as a website OAuth connect.

Since 1 January 2026 merchants can no longer create legacy custom apps, so the
token path in the wizard only stays for stores that already have one. It is
shown only when the public app isn't configured.

## Why an embedded app

App Store requirements that shape everything here:

| Rule | What it means for us |
| --- | --- |
| 1.2.1 | A merchant who installs from Shopify pays through **Shopify Billing**, never Stripe |
| 2.2.3 | The app loads inside the admin with **App Bridge** (`/shopify`) |
| 2.3.1–2.3.4 | Install starts on Shopify, auth happens first, no manual `xxx.myshopify.com` entry |
| GDPR | The 3 compliance webhooks are declared in `shopify.app.toml` |

## Flow

1. The merchant installs from the App Store. With Shopify-managed install
   (`use_legacy_install_flow = false`), Shopify grants the scopes from the TOML
   and opens `application_url` = `https://oneshoplab.com/shopify` in the admin
   iframe.
2. `/shopify` (`src/app/shopify/*`, its own root layout) loads App Bridge
   (the `shopify-api-key` meta tag, then the synchronous
   `cdn.shopify.com/shopifycloud/app-bridge.js` script, first in `<head>`).
   The client (`views/shopify-app`) calls `/api/shopify/app/*`, sending
   `Authorization: Bearer <idToken>`.
3. `authenticateEmbedded` verifies the ID token. It is HS256 signed with the
   client secret; the checks are exp/nbf ±10 s, aud = client id and
   iss host = dest host. `ensureEmbeddedInstall` then runs the **token
   exchange** for an offline token and reads the shop facts (name, email,
   primary domain, `partnerDevelopment`, granted scopes) into `shopify_shops`.
   While the shop isn't linked yet, the token is re-exchanged on every visit,
   so a stale token can't survive an uninstall we never heard about.
4. **Onboarding** (`state.kind === 'onboarding'`):
   - **Create my space** (`onboardShopifyShop`). The account uses the shop
     owner's email and gets `billing_channel = 'shopify'`. It receives the
     same 150 welcome credits and the same `signup_tos` consent row as a web
     signup, plus a project on the primary domain. Then the shop is attached:
     `connectShopify`, webhooks, pull.
   - **Link my account**, when the email already exists or the merchant has an
     account. The embedded app gets a 15-minute HMAC link token and opens
     `/{locale}/shopify-link?t=…` in a new tab. The merchant logs in and
     confirms, and `linkShopToUser` attaches the shop. A free account switches
     to `billing_channel = 'shopify'`. A live Stripe plan keeps running on the
     web until it ends; the embedded app then says the plan is managed on
     oneshoplab.com.
5. **Ready**: the page shows score, synced products, pending changes, credits,
   a Sync button, and "Open OneShopLab". That button signs the merchant in
   through a 2-minute single-use SSO token (`/api/shopify/sso`, next-auth
   provider `shopify-sso`) and opens the dashboard in a new tab. The page also
   holds plans, packs and cancel, when billed by Shopify.

## Framing and headers

- `src/proxy.ts` answers `/shopify` without the locale redirect. It sets
  `Content-Security-Policy: frame-ancestors https://{shop} https://admin.shopify.com`,
  with the shop taken from the `shop` query param.
- `next.config.ts` keeps `X-Frame-Options: DENY` on every path **except**
  `/shopify`.
- nginx: the server block adds `X-Frame-Options DENY` and an enforced CSP
  itself. `location = /shopify` and `location ^~ /shopify/` in
  `/etc/nginx/conf.d/oneshoplab.conf` (and the staging vhost) include
  `snippets/oneshoplab-shopify-embedded.conf` instead. That snippet has the
  same security headers, no XFO, and `cdn.shopify.com` in `script-src`. Any
  `add_header` in a location drops the server-level ones: keep the snippet
  complete.

## Billing (`features/shopify-connector/api/app-billing.ts`)

Shopify is the source of truth. Return URLs and webhooks only tell us to
look; every decision re-reads the charge from the Admin API.

| | Shopify object | Name (parsed back) | Credits |
| --- | --- | --- | --- |
| Plan | `appSubscriptionCreate`, `EVERY_30_DAYS` or `ANNUAL` | `OneShopLab Pro (yearly)` | first paid plan: subscription bucket set to the allowance; upgrade: the difference; downgrade: nothing now |
| Pack | `appPurchaseOneTimeCreate` | `OneShopLab Power pack (2000 credits)` | pack bucket + credits, idempotency `shopify-pack-{gid}` |
| Cancel | `appSubscriptionCancel` | — | back to free |

- `test: true` is sent when the shop is a development store
  (`plan.partnerDevelopment`), so review and our own tests never charge.
- Return URL: `/api/shopify/billing/return?shop&kind=subscription|pack`, then
  `charge_id` for packs. It applies and then redirects to
  `https://{shop}/admin/apps/{client_id}`.
- Webhooks `app_subscriptions/update` and `app_purchases_one_time/update`
  arrive on the app-level route (`/api/webhooks/shopify/app`, signed with the
  client secret). They are also registered per project on OAuth connections.
  Both paths are idempotent.
- **Monthly refills**: Shopify sends no per-cycle event. Each Shopify
  subscription carries `next_credit_refill_at`. Monthly plans refill every
  30 days; yearly plans on the same day each calendar month (`nextRefill`).
  The hourly worker (`refillShopifySubscriptions`) asks Shopify whether the
  subscription is still ACTIVE before resetting the bucket.
- **Uninstall**: Shopify cancels the charges, and we mirror that
  (`onShopifyAppUninstalled`). The plan billed on that shop ends; when no
  installed shop is left, the account goes back to `billing_channel = 'stripe'`
  and can buy on the website again.
- **Web guard**: a `billing_channel = 'shopify'` account can't open Stripe
  Checkout (`/pricing?error=shopify_billing`). `/pricing` and
  `/account/credits` replace every buy button with "Manage in Shopify", which
  links to the embedded app.

### Stripe yearly fix (same change)

A Stripe yearly plan used to get its credits once a year. It now gets
`next_credit_refill_at` when the invoice grants the plan
(`scheduleStripeRefill`), and `refillStripeYearlySubscriptions` resets the
subscription bucket monthly while `current_period_end` is in the future.

## Prices (`pricing.json` → `shopifyBilling`)

Shopify bills in USD. The rule is **same value as the euro price**:
EUR/USD 1.1382 (2026-09-27), with Shopify's 2.9% processing fee absorbed,
rounded to .99. What we keep per sale matches Stripe within 3%. The revenue
share is 0% on the first $1M lifetime, then 15%. A unit test pins that and
checks that offers rank by price per credit exactly as on the site. Revisit
if EUR/USD moves by more than ~5%.

| | EUR (site) | USD (Shopify) |
| --- | --- | --- |
| Starter / Pro / Scale monthly | 39.99 / 89.99 / 199.99 | 46.99 / 104.99 / 234.99 |
| Yearly | ×12 −20 % | ×12 −20 % |
| Boost / Power / Mega / Catalog | 4.99 / 17.99 / 59.99 / 249 | 5.99 / 20.99 / 69.99 / 289 |

## Configuration

- `.env`: `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET`,
  `SHOPIFY_APP_SCOPES` (default `read_products,write_products,write_files`).
  Add `SHOPIFY_APP_STORE_URL` once the listing is live: the website wizard
  then sends merchants to the App Store instead of the domain form.
- `shopify.app.toml` at the repo root holds URLs, scopes, managed install and
  the webhooks. Push it with the Shopify CLI (`shopify app config link`, then
  `shopify app deploy`), or copy the same values into the Dev Dashboard.

## Tests

- `tests/unit/shopify-app-store.test.ts`: ID token, charge names, USD prices
  vs EUR, `nextRefill`.
- `tests/db/shopify-app-store.test.ts`: install + onboarding, linking (free
  vs live Stripe), charges in test mode, grant/upgrade idempotency, packs via
  return and webhook, cancel, refills (and a cancellation seen only by the
  refill), uninstall, the app-level webhook route, the web guard, Stripe
  yearly refills.
