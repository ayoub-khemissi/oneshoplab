# Shopify connector (phase 3) — custom-app token, no plugin

Status: spec v1, 2026-08-30. Shopify has no "plugin": the merchant creates a
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
- Token invalid (401 from Shopify) → status `token_invalid`, merchant notified
  in the Integrations tab + email; no retries until a new token is saved.
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

## Not in scope
Public Shopify app (OAuth, app store review), billing API, theme edits,
inventory writes.
