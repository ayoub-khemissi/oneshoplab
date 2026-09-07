---
status: acted
implemented: partial
last-verified: 2026-09-07
---

# Wix connector — Wix app (OAuth), Wix Stores products

Backend implemented 2026-08-30 (`features/wix-connector`, migration
`0029_shop_oauth_wix`); wizard UI shipped 2026-08-30 (`features/wix-connector/ui`: `WixInstallButton`, `WixConnectionCard`; mocks `wix-*` in `features/integrations/ui/mocks`). Wix has no "custom app" token: the
merchant installs **our Wix app** on their site; the credential for a site is
its `instanceId`, from which OSL mints OAuth access tokens (client credentials)
and talks to the Wix Stores REST API on the merchant's behalf.

> **2026-09-07 — migrated off custom authentication.** Wix no longer offers the
> redirect flow (`installer/install` → `code` → refresh token) to new apps: the
> Dev Center has no redirect-URL field any more and the installer answers "no
> app with this redirect URL". The connector now uses the *external install
> flow* + client-credentials OAuth described below. `refresh_token_ciphertext`
> stays null on Wix rows.

## Env
`WIX_APP_ID`, `WIX_APP_SECRET` (Dev Center → Develop → OAuth), `WIX_APP_PUBLIC_KEY`
(Dev Center → Webhooks, PEM; `\n` escapes accepted so it fits one `.env`
line), `WIX_SHARE_URL_ID` (the GUID at the end of the app's *Share Install
Link* — Distribute → Share Install Link, needs a released major version;
required by the external install flow while the app is unlisted). `isWixAppConfigured()` (`@/features/wix-connector`) = id + secret set;
without the public key webhooks are refused (401) and the connection lives on
pulls (nightly + "Synchroniser").

## Flows
- **Install** `GET /api/integrations/wix/install?projectId[&locale]` (session
  + ownership) → signed state cookie `osl_wix_oauth` (10 min, same helper as
  Shopify) → 302 `https://www.wix.com/app-installer?appId[&shareUrlId]&postInstallationUrl=<callback?state>`.
  Nothing per site is registered in the Dev Center: the callback travels in the
  installation URL.
- **Callback** `GET /api/integrations/wix/callback?state&appId&tenantId&instanceId&signedInstance`
  → cookie ↔ `state`, session user = state user → `signedInstance` verified
  (`lib/signed-instance.ts`: HMAC-SHA256 of the base64url data, keyed with the
  app secret) and its `instanceId` must equal the plain one → site name/host
  from `GET /apps/v1/instance` (first token minted here) → `platform='wix'`,
  `auth_mode='oauth'`, `instance_id` → pull queued → 302
  `/{locale}/dashboard/sites/{projectId}?tab=integrations&connected=wix`
  (failure: `?error=` ∈ `not_configured | bad_state | unauthorized |
  bad_request` (missing or unverifiable `signedInstance`) `| exchange_failed`
  (signed instance ≠ query instance) `| unreachable | not_found`).
- **Catalog V1 vs V3** (2026-09-07): Wix Stores runs two incompatible
  catalogues; new sites are V3 and answer 428 to V1 calls (`Endpoint belongs
  to CATALOG_V1, but your site is using CATALOG_V3`). The client detects the
  version once (`GET /stores/v3/provision/version`, or the first V1 428) and
  routes every method: V3 products are folded into the V1 `WixProduct` shape
  (`lib/v3-product.ts`) so pull / apply / image ops are written once; V3
  descriptions are rich content only, so our HTML is converted
  (`lib/rich-content.ts`); V3 media is one array fully overwritten (add = keep
  existing ids + new urls); V3 ribbons are set by name; V3 categories come
  from the product's breadcrumbs, so `collections()` is empty there.
- **Client** (`api/client.ts`): access token minted with client credentials (`POST /oauth2/token`, app id + secret + `instance_id`, 4 h) on
  demand (`grant_type=refresh_token`, cached 4 min — Wix tokens live 5),
  `Authorization: <token>`; 401/403 → `token_invalid` (status flipped, one
  alert). Products: `POST /stores/v1/products/query` (100/page,
  `includeVariants`), `GET /stores/v1/products/{id}`, `PATCH
  /stores/v1/products/{id}` (name / description / ribbon), `POST
  /stores/v1/products/{id}/media` (`{url}` items — Wix fetches the R2 URL),
  `POST /stores/v1/collections/query` once per pull (id → name).
- **Mapping** (`lib/map-product.ts`): sourceId = Wix product id, `sourceUrl`
  from `productPageUrl`, images = media items of type image with `title` as
  alt, price range → priceMin/Max, `brand` → vendor, **ribbon → the single
  tag**, **first collection name → productType**, `lastUpdated`. Wix has no
  tags: an approved `tags` change writes the first tag as ribbon (30 chars).
- **Pull / apply / webhooks** mirror Shopify. The apply loop itself (list
  pending → expiry → re-read → `priorValueHash` → write → ack) is shared:
  `applyPendingChanges` in `entities/product-change` (`api/apply-loop.ts`,
  driver = `{ readProduct, writeChange, isAuthError }`); both connectors are
  thin drivers over it.
- **Webhook** `POST /api/webhooks/wix` (one URL per app — Wix does not route
  per site): body is a JWT (RS256) verified with `WIX_APP_PUBLIC_KEY`,
  `instanceId` → connection, replay guard on `jti` (24 h idempotency table),
  then Product Created/Updated → one-product re-read + upsert, Product
  Deleted → archive, App Removed → status `revoked` + refresh token wiped.
  Both the legacy envelope (`eventType: ProductChanged`, `data.productId`)
  and the REST-style one (`entityFqdn` + `slug`, `entityId`) are parsed.
- **Worker**: `runWixApplies` + `runWixRequestedPulls` every tick,
  `runWixNightlyPulls` hourly (24 h gate), next to the Shopify ones.

## Server actions (`@/features/wix-connector/actions`)
Same shapes as the Shopify ones so the card can be mirrored:
`getWixConnectionAction(FormData{projectId}) → WixConnectionView | null`
(`WixConnectionView` = `ShopifyConnectionView`, now with `platform` +
`authMode`), `getWixInstallUrlAction(FormData{projectId, locale}) → {ok, url}
| {ok:false, error}` (the browser then navigates to the install route),
`requestWixPullAction`, `disconnectWixAction` → `{ok:true} | {ok:false,
error: 'unauthorized' | 'bad_request' | 'not_found' | 'not_configured'}`.
"Disconnect" wipes our side only; the merchant removes the app from the Wix
dashboard (we then receive App Removed).

## Dev Center checklist
- App type: Wix app (OAuth), **not** self-hosted/Blocks.
- OAuth: App ID / App Secret → env; Redirect URL
  `https://oneshoplab.com/api/integrations/wix/callback`; App URL
  `https://oneshoplab.com/api/integrations/wix/install` (a marketplace-started
  install lands there without `projectId` → 400; the merchant starts from OSL).
- Permissions: **Wix Stores – Manage Products** (read + write products,
  collections read comes with it), **Read Site Properties / App Instance**
  (site name + URL for the card).
- Webhooks: Wix Stores → Product Created, Product Updated, Product Deleted;
  App Management → App Removed; all to `https://oneshoplab.com/api/webhooks/wix`.
  Copy the public key to `WIX_APP_PUBLIC_KEY`.
- Privacy policy `https://oneshoplab.com/en/privacy`; the app must be
  published (or the site whitelisted as a test site) before a merchant can install.

## Data
Reuses `shop_connections` (`platform='wix'`, nullable `instance_id` +
`refresh_token_ciphertext`, `access_token_ciphertext` empty) — one row per
project whatever the platform, so the card / polling / alerts code is
shared. Tests: `tests/unit/wix-connector.test.ts` (mapper, JWT with a
generated RSA key pair, envelope parsing), `tests/db/wix-connector.test.ts`
(install → callback with `fetch` stubbed, pull, apply incl. conflict + 401,
actions, webhook route).

## Site language

Every pull also reads `GET /site-properties/v4/properties?fields.paths=language&fields.paths=locale`
(the app's own scope suffices) and records `properties.language` as the project's
*store language* (`projects.store_language`, ISO 639-1). It drives every AI
generation on the site unless the merchant set an explicit override in Settings;
Shopify (primary-domain locale) and the WooCommerce plugin ≥ 1.8.0
(`get_locale()` on each sync batch) feed the same column. A refused or failing
Site Properties call only logs a warning — the catalogue still lands.
