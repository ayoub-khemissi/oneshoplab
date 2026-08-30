---
status: acted
implemented: partial
last-verified: 2026-08-30
---

# Wix connector — Wix app (OAuth), Wix Stores products

Backend implemented 2026-08-30 (`features/wix-connector`, migration
`0029_shop_oauth_wix`); wizard UI pending. Wix has no "custom app" token: the
merchant installs **our Wix app** on their site, OSL keeps the app's refresh
token and talks to the Wix Stores REST API on the merchant's behalf.

## Env
`WIX_APP_ID`, `WIX_APP_SECRET` (Dev Center → OAuth), `WIX_APP_PUBLIC_KEY`
(Dev Center → Webhooks, PEM; `\n` escapes accepted so it fits one `.env`
line). `isWixAppConfigured()` (`@/features/wix-connector`) = id + secret set;
without the public key webhooks are refused (401) and the connection lives on
pulls (nightly + "Synchroniser").

## Flows
- **Install** `GET /api/integrations/wix/install?projectId[&locale][&token]`
  (session + ownership) → signed state cookie `osl_wix_oauth` (10 min, same
  helper as Shopify) → 302
  `https://www.wix.com/installer/install?appId&redirectUrl&state[&token]`.
- **Callback** `GET /api/integrations/wix/callback?code&instanceId&state` →
  cookie ↔ `state`, session user = state user → `POST
  https://www.wixapis.com/oauth/access` (`grant_type=authorization_code`) →
  refresh token sealed (`refresh_token_ciphertext`), `instance_id`,
  `platform='wix'`, `auth_mode='oauth'`; site name/host from
  `GET /apps/v1/instance` → pull queued → 302
  `/{locale}/dashboard/sites/{projectId}?tab=integrations&connected=wix`
  (failure: `?error=` ∈ `not_configured | bad_state | unauthorized |
  bad_request | exchange_failed | unreachable | not_found | no_key |
  invalid_token`). The dashboard redirect is deliberate: the merchant started
  from OSL. If Wix ever requires the
  `https://www.wix.com/installer/close-window?access_token=` hop to mark the
  app installed, do it from the callback before the dashboard redirect — to
  confirm at the first real install.
- **Client** (`api/client.ts`): access token minted from the refresh token on
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
