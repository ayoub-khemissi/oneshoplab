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
   and opens `application_url` = `https://oneshoplab.com` in the admin
   iframe. The root with `?embedded=1&shop=` redirects to `/shopify`.
2. `/shopify` (`src/app/shopify/*`, its own root layout) loads App Bridge
   (nginx injects the `shopify-api-key` meta tag and the synchronous
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
   a Sync button, and "Open OneShopLab". That button opens the site's
   dashboard in the same frame with a fresh ID token (see below). The page
   also holds plans, packs and cancel, when billed by Shopify.

## Expiring offline tokens

Shopify requires public apps created after 2026-04-01 to use expiring offline
tokens; all public apps must from 2027-01-01. The Dev Dashboard flags anything
else as "Jeton hors ligne obsolète".

- Both grants ask for them: token exchange sends `expiring=1`, and the
  website code exchange sends `expiring: 1`. The access token lives 1 h. The
  refresh token lives 90 days and rotates on every refresh.
- `shop_connections` stores `refresh_token_ciphertext`,
  `access_token_expires_at`, `refresh_token_expires_at` and
  `token_refresh_lock_until`. The pending grant of an unlinked shop is sealed
  as JSON in `shopify_shops.pending_token_ciphertext`.
- Every Admin client built on a stored connection receives
  `tokenProvider: shopifyTokenProvider(projectId, secrets)` (`api/token.ts`).
  The provider keeps a token that has more than 5 minutes left. Otherwise it
  refreshes it. Only one process refreshes a store at a time: the others
  wait for the stored result.
- A dead refresh token (401) raises `token_invalid`, like a refused API
  call. That triggers the usual alert, and the next embedded visit
  re-exchanges. A transient failure while the token still works keeps the
  current token.
- Nightly pulls touch every connected store, so a refresh token never
  reaches its 90 days.
- Custom-app tokens have no refresh token and are left untouched.

## The full app inside the admin (requirement 2.2.2)

The web app itself runs inside the Shopify admin: the same pages and the same
code, no second interface. Three pieces make that work.

**Session without cookies (1.1.1).** Inside the admin, the Shopify ID token
is the session.
- A first document load carries it as `?id_token=`. The embedded home's
  "Open OneShopLab" and every admin reload add it.
- App Bridge adds it as `Authorization: Bearer` to every same-origin
  `fetch`: Next's client navigations and server actions.
- `src/proxy.ts` turns `?id_token=` into that header, sets
  `x-osl-embedded: 1` (never trusted from the client), skips the cookie
  login gate, and sends `/login`, `/signup` and `/forgot-password` to
  `/shopify`.
- `auth()` (`entities/user/api/next-auth.ts`) first resolves a valid Bearer
  ID token to the account the shop is linked to
  (`embedded-session.ts`, cached per request). Otherwise it falls back to
  Auth.js. An unlinked shop or an uninstalled app gets no session.

**Chrome.** With `x-osl-embedded`, the locale layout swaps `SiteHeader` for
`EmbeddedHeader` (Dashboard, Plan & billing → `/shopify`, bell, credits).
It drops the footer, cookie banner, analytics and service worker, and mounts
`EmbeddedLinkGuard`. That guard turns plain `<a>` clicks that would reload
the frame without a session into router navigations, and `/api/*` files into
fetched downloads (`shared/embedded`). Billing links (pricing, credits,
subscription) point to `/shopify` in the same frame
(`shopifyBillingLink`), so no Stripe screen can open inside the admin.

**One shop, one site.** Inside the admin, the app reaches only the shop's
own site. An owner may have linked other stores: other businesses, other
platforms. The shop's staff must neither see them nor act on them.
- The embedded session carries `embedded: { shop, projectId }`.
- `enforceEmbeddedScope` redirects to the shop's site, or to `/shopify`
  before linking. It runs at the top of each page (the sites list, every
  page under `sites/[siteId]`, "add a site" and admin) and never in a
  layout: Next renders a page in parallel with its layouts, so a layout
  guard would still stream the page's data.
- The bell, mark-all-read and the audit toasts are filtered to that site.
- `outsideEmbeddedScope` refuses deleting a site, creating a site key,
  disconnecting a store and sending changes for any other site.
- `sessionOutsideScope` does the same in the CSV export and import routes
  and in the bulk generation routes.
- Other site ids are random UUIDs and are never shown inside the admin.
- Credits, plan and account pages stay account-wide.

**Framing, App Bridge first (2.2.3).** A framed document says so
(`Sec-Fetch-Dest: iframe`).
- `next.config.ts` drops X-Frame-Options for it.
- The proxy answers with `frame-ancestors https://admin.shopify.com https://*.myshopify.com`.
- nginx does the rest for framed documents only
  (`scripts/ops/nginx/oneshoplab-embedded.conf` →
  `/etc/nginx/conf.d/00-oneshoplab-embedded.conf`):
  - no XFO, and a frame-ancestors in its enforced CSP;
  - `cdn.shopify.com` in script-src;
  - the upstream answers uncompressed and `sub_filter` injects
    `<meta name="shopify-api-key">` + the App Bridge script as the first tags
    of `<head>`. Next.js emits its own scripts first, so the app cannot do it
    itself.

Change the App Bridge key in that file if the app's client id changes.

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

### Test charges (development stores)

On a development store, and on any store before it's transferred to a paying
merchant, Shopify only allows **test** charges, which cost nothing. Anyone can
open a free development store and install a listed app. So a test charge
activates the plan or pack as usual, but credits at most
`shopifyBilling.testCreditCap` (500) **per account in total**: the plan's
credits, the upgrade differences and the packs together, with no monthly
refill. `grantTestCredits` counts the `shopify_test_grant` ledger rows. The
embedded app's test banner states the cap, and so do the review
instructions below.

### Review instructions (paste into the App Store submission)

> OneShopLab audits a store's product catalog and rewrites titles,
> descriptions, tags and photos with AI. Nothing is published without the
> merchant's approval. Every AI generation spends credits.
>
> 1. Install the app. It opens in the Shopify admin. Click **Create my
>    workspace**. The account is created from the store owner's email with
>    150 free credits; no password is needed.
> 2. The dashboard shows the catalog score, synced products, pending
>    changes and credits. **Sync** pulls the products again.
> 3. **Open OneShopLab** opens the full app in a new tab, already signed in,
>    to generate and approve improvements. Approved changes are written back
>    to the store's products.
> 4. Billing uses the Shopify Billing API only: plans (monthly or yearly)
>    and one-time credit packs. On development stores every charge is a
>    **test charge**. It activates the plan or pack normally, but the
>    credits it grants are **capped at 500 per account in total** and never
>    refilled, so the app can't be used for free from development stores.
>    The app shows this notice. Charges on paying stores grant the full
>    amount.
> 5. **Go back to the free plan** cancels the subscription.

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
