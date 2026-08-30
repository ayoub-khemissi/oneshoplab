# Shopify connector (phase 3) — custom-app token, no plugin

Status: spec v1, 2026-08-30 — backend + wizard branch implemented 2026-08-30; public app (OAuth) + GDPR webhooks backend 2026-08-30 (see "Implementation notes"). Shopify has no "plugin": the merchant creates a
**custom app** in their admin and gives OSL its Admin API access token. OSL
then does what the WooCommerce plugin does, from its own side: pull the
catalog, receive webhooks, and write approved changes back.

## Merchant flow (wizard, Shopify branch — replaces "Bientôt disponible")
1. Admin → Settings → Apps and sales channels → **Develop apps** → *Allow
   custom app development* (once) → **Create an app** ("OneShopLab").
2. Configuration → Admin API integration → scopes (exact list, Copy button):
   `read_products, write_products, read_product_listings` (+ `read_inventory`
   for stock, optional). Save.
3. **Install app** → API credentials → *Admin API access token* → **Reveal
   token once** → copy.
4. Paste in OSL: shop domain (`xxx.myshopify.com`, auto-derived from the
   audited domain when it is a myshopify store) + token → OSL calls
   `shop.json` to validate → green card "Connecté à <shop name>". OSL registers
   the webhooks and starts a full catalog pull (progress on the card).
Every mock view for these screens lives in `features/integrations/ui/mocks`.

## Data & security
- `shop_connections`: id, projectId (unique), platform ('shopify'), shopDomain,
  accessTokenCiphertext (AES-256-GCM with `INTEGRATION_ENCRYPTION_KEY` from
  `.env`, 32 bytes base64; key id column for rotation), scopes json,
  apiVersion, webhookSecret, status (connected|token_invalid|revoked),
  lastPullAt, lastWebhookAt, lastError, createdAt, revokedAt.
- Token never returned to the browser after save; UI shows shop domain +
  status only. "Disconnect" deletes the ciphertext and the webhooks.
- Webhook HMAC (`X-Shopify-Hmac-Sha256`) verified with the app's webhook
  secret (custom apps use the API secret key — stored the same way); replay
  guarded by `X-Shopify-Webhook-Id` idempotency (24 h, same table as v1).
- Token invalid (401 from Shopify) → status `token_invalid`, merchant notified once per invalidation (bell `integration_token_invalid` + email with the recreate → paste → done steps; `shop_connections.last_alert_*` is the marker, reset by a new token). A full pull that ends in error or hits the plan cap raises `integration_sync_failed` at most once per 24 h per connection.
  No retries until a new token is saved.
- Rate limits: Admin GraphQL cost-based; the puller respects
  `throttleStatus` and backs off; full pull uses `products(first: 250)`
  cursor pagination; one pull per project at a time (same advisory lock as
  v1 sync).

## Flows
- **Full pull** (on connect, on "Synchroniser", and nightly by the worker):
  GraphQL products → OSL `NormalizedProduct` (same mapper family as the
  storefront adapter, but from Admin fields: descriptionHtml, variants with
  price/sku/availableForSale, media images with alt, tags, vendor,
  productType, updatedAt) → `syncProjectProducts` full mode.
- **Webhooks** `products/update`, `products/delete` → partial sync / archive
  (route `POST /api/webhooks/shopify/{projectId}` — public, HMAC-verified).
- **Apply changes**: the worker polls `product_changes` for projects with a
  Shopify connection (pending, oldest first), computes `priorValueHash` check
  by re-reading the product, then `productUpdate` (title/descriptionHtml/
  tags) or `productCreateMedia` (images from R2 URLs — Shopify fetches them;
  the R2 link must still be valid → skip with `expired` if not), then acks
  internally with the same semantics as the plugin (`applied` / `conflict` /
  `failed`). Merchant sees the same "Appliqué ✓" on the product page.
- **Disconnect / project deletion**: delete webhooks (best effort), wipe the
  token, status `revoked`.

## Placement (FSD)
`entities/shop-connection` (table, encryption, status), `features/shopify-connector`
(admin client, mappers, pull, webhook handling, apply worker step), routes
`app/api/webhooks/shopify/[projectId]`, wizard branch in `features/integrations`,
worker step in `src/worker` (rides the existing tick, every 5 min for applies,
nightly for pulls). Tests: mapper unit tests from recorded GraphQL fixtures,
DB tests for connect/validate/disconnect/apply-ack, webhook HMAC tests.

## Public app (OAuth) — 2026-08-30
Second install path next to the custom-app token (both end in the same
`shop_connections` row; `auth_mode` = `custom_app` | `oauth`,
`installed_via_oauth_at`; migration `0029_shop_oauth_wix`).

- Env: `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET`,
  `SHOPIFY_APP_SCOPES` (default `read_products,write_products`);
  `isShopifyAppConfigured()` (`@/features/shopify-connector`) gates the UI path.
- `GET /api/integrations/shopify/install?projectId&shop[&locale]` — session +
  ownership, domain normalised → signed state cookie `osl_shopify_oauth`
  (HMAC-SHA256 with the client secret over `{projectId, userId, locale, shop,
  nonce, issuedAt}`, 10 min, `shared/lib/oauth-state.ts`) → 302
  `https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state`.
- `GET /api/integrations/shopify/callback` — order of checks: state cookie ↔
  `state` → query `hmac` (sorted params, hex HMAC of the client secret) →
  session user = state user → `shop` = state shop → `POST
  /admin/oauth/access_token` (offline token) → granted scopes ⊇ configured
  (`write_x` satisfies `read_x`) → `shop { name }` → row saved with the client
  secret as webhook secret → webhooks `PRODUCTS_UPDATE`, `PRODUCTS_DELETE`,
  `APP_UNINSTALLED` → pull queued → 302
  `/{locale}/dashboard/sites/{projectId}?tab=integrations&connected=shopify`
  (`&warning=webhooks_failed` when registration failed). Any failure → same
  tab with `?error=` ∈ `not_configured | bad_state | bad_hmac | unauthorized |
  invalid_domain | exchange_failed | scopes_missing | unreachable | not_found |
  no_key`.
- `app/uninstalled` (registered for OAuth installs only) → status `revoked`,
  ciphertexts wiped, `lastError = "app/uninstalled"`. Pull/apply/webhooks are
  the custom-app code paths unchanged.

## GDPR webhooks (mandatory for app review)
`POST /api/webhooks/shopify/gdpr/{customers-data-request | customers-redact | shop-redact}`
— HMAC (`X-Shopify-Hmac-Sha256`, client secret) or 401. OSL stores no
customer data: every request is logged in `gdpr_requests` (shopDomain,
topic, payload, receivedAt) and answered 200; `shop/redact` additionally
revokes every connection of that shop domain and wipes their ciphertexts.

### App-review checklist (Partner Dashboard)
- App URL: `https://oneshoplab.com/en/dashboard` (install starts from OSL, not from Shopify).
- Allowed redirection URL: `https://oneshoplab.com/api/integrations/shopify/callback`.
- Compliance webhooks: the three GDPR URLs above.
- Scopes requested: `read_products, write_products`.
- Privacy policy URL: `https://oneshoplab.com/en/privacy`.
- Uninstall: `app/uninstalled` is subscribed per install (Admin API), not in the dashboard.

## Not in scope
Billing API, theme edits, inventory writes.

## Implementation notes (2026-08-30, backend)
- Table `shop_connections` (migration `0027_milky_sunspot`): as above plus
  `shop_name`, `webhook_ids` (subscription ids deleted on disconnect),
  `pull_requested_at` (connect / "Synchroniser" queue a pull; the worker
  runs it on its next tick) and `pull_progress` json
  (`{ phase, fetched, startedAt, finishedAt?, error? }`) for the card.
  Both secrets live as `*_ciphertext` (`v1:<iv>:<tag>:<data>`, key id `v1`).
- **API secret key is optional.** Without it the HMAC cannot be verified, so
  no webhook is registered and the connection lives on pulls (nightly +
  manual). With it, `products/update` + `products/delete` are registered at
  connect time.
- Page size is `products(first: 20)` with 10 variants + 10 media per
  product: Shopify caps a single query at 1 000 requested cost points and
  `first: 250` with nested connections is refused outright. The client
  waits on `throttleStatus` between pages and retries `THROTTLED`.
- Plan limit on a pull: the pull stops at `maxProductsForPlan` and records
  `pullProgress.error = "plan_limit:<n>"` (a plugin batch is rejected
  instead — a pull has no caller to answer).
- `token_invalid` is set on any 401/403 (pull, apply, webhook re-read); the
  merchant is not emailed yet — the Integrations card reads `status`.
- Entry points for the wizard: `connectShopifyStore`, `disconnectShopifyStore`,
  `requestShopifyPull` (`@/features/shopify-connector`), `getConnectionForUser`
  (`@/entities/shop-connection`).

## Wizard branch (2026-08-30)
- Server actions `connectShopifyAction` / `disconnectShopifyAction` /
  `requestShopifyPullAction` / `getShopifyConnectionAction` live in
  `features/shopify-connector/api/actions.ts` (entries `/actions`, `/client`);
  the UI (`ShopifyConnectForm`, `ShopifyConnectionCard`) in
  `features/shopify-connector/ui/`. Reasons come back as codes translated
  under `Integrations.shopify.error.*`; the token is never returned.
- The wizard is a **widget** (`src/widgets/integrations-wizard`): it composes
  `features/integrations` (picker, guide, site key, WooCommerce card) with
  `features/shopify-connector` — features never import each other. For
  Shopify there is no site key step: step 3 is the token form, step 4 the
  connection card (status, "Synchroniser maintenant", "Déconnecter" behind
  a confirmation that links to the Shopify apps page).
- `ShopifyConnectionView` (`entities/shop-connection`, `toShopifyConnectionView`)
  is the serialisable, secret-free shape polled by the card every 10 s;
  `Integrations.getConnectionStatusAction` carries it as `shopify` too.
- An obviously invalid domain is refused client-side (`normalizeShopDomain`
  from `@/entities/shop-connection/client`) before any network call.
