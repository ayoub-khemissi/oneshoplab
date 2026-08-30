# Integration API v1 — store plugins ↔ OneShopLab

Status: **spec v1, 2026-08-30** — implemented in phases (see bottom).
Audience: OSL developers and plugin authors (WooCommerce plugin, Shopify
connector, Wix app). Base URL: `https://oneshoplab.com/api/v1`.

## 1. Goals and non-goals

Goal: a store plugin holds one OSL **site key** and can (a) push the catalog
to OSL (replacing public-storefront scraping), (b) pull the **changes** the
merchant approved in OSL (rewritten title/description/tags, generated images)
and (c) acknowledge what it applied. OSL stays the source of truth for
*generations*; the store stays the source of truth for *products*.

Non-goals (v1): OSL writing into the store directly (that is the Shopify
custom-app connector, phase 3), real-time push to plugins (outbound webhooks,
phase 4), multi-store keys, end-user OAuth.

## 2. Authentication

- **Site key**: `osl_live_<43 chars base64url>` (256 bits). Format is
  recognisable by secret scanners; `osl_test_` prefix reserved for a future
  sandbox. Shown **once** at creation; OSL stores `sha256(key)` and the first
  12 chars (`prefix`) for lookup. Lookup by prefix → constant-time compare of
  the hash. Never logged (only the prefix).
- Scope: one key = one **project** (site) + a permission set:
  `catalog:write`, `changes:read`, `changes:ack` (all three by default;
  read-only keys for reporting integrations possible).
- Transport: `Authorization: Bearer <key>` over TLS **plus** request
  signature `X-OSL-Signature: t=<unix seconds>,v1=<hex hmac>` where
  `v1 = HMAC-SHA256(key, "${t}.${METHOD}.${path}.${sha256(rawBody)}")`.
  Window ±300 s. Signing binds method/path/body to the key holder, so a
  leaked access log or proxy dump cannot replay a request with a different
  body, and a missing/invalid signature is rejected even with a valid bearer.
- `GET /api/v1/site` doubles as the "test connection" call.

Errors are a stable envelope `{ "error": { "code", "message", "details"? } }`.
Auth codes: `unauthorized` (missing/unknown/mismatched — deliberately
indistinguishable), `key_revoked`, `key_expired`, `signature_invalid`,
`clock_skew` (with server time in `details.serverTime`), `forbidden`
(permission or another project), `rate_limited` (`Retry-After`).

### Lifecycle (edge cases first)

| Event | Behaviour |
|---|---|
| Create | dashboard → site settings → Integrations; name + permissions + optional expiry (max 2 y). Secret shown once. `api_key_events` row `created`. |
| Rotate | "Rotate" creates a new key and puts the old one in **grace** for 24 h (both valid, old flagged `rotatedTo`), then auto-revokes. Plugin shows a banner while in grace. |
| Revoke | immediate; in-flight requests already authenticated finish; next request → `key_revoked`. Idempotency records keep working for the new key only. |
| Expire | `expiresAt` ≤ now → `key_expired` (distinct from revoked so the plugin can say "renew"). Worker sends the owner an email 7 days before. |
| Project deleted / account deleted | keys cascade-revoked (FK `onDelete: cascade` on the table + explicit event). |
| Plan downgrade | keys keep working; **write limits** are enforced per request (§4). |
| Lost key | cannot be recovered → rotate. |
| Brute force | prefix lookup only on a unique index; auth failures rate-limited per IP (20/min) with a generic `unauthorized`. |
| Key used from browser | rejected: CORS is not enabled on `/api/v1` (server-to-server only). |

## 3. Endpoints

All JSON. Max body 1 MiB (`413 payload_too_large`). Timestamps ISO-8601 UTC.
Cursors are opaque strings.

### `GET /site`
→ `{ site: { id, name, domain, platform, plan, limits: { maxProducts, batchSize } }, key: { prefix, permissions, expiresAt, graceUntil? }, serverTime }`.

### `POST /products/sync` — `catalog:write`
Upsert a batch. Body:
```json
{ "mode": "partial" | "full",
  "session": "opaque (full mode only, from the first response)",
  "final": true,
  "products": [ NormalizedProduct… max 200 ] }
```
`NormalizedProduct` is the OSL shape (`sourceId` required, `title` required,
`descriptionHtml`, `images[{src,alt,width,height,position}]`, `tags[]`,
`variants[]`, `vendor`, `productType`, `priceMin/Max`, `currency`, `sku`,
`sourceUrl`, `handle`, `sourceUpdatedAt`).
- **partial**: upsert only; nothing archived.
- **full**: multi-page. First call without `session` opens one (TTL 30 min);
  every page adds ids to the session; the page with `final: true` archives
  products not seen in the session, then closes it. A session that never
  gets `final` expires without archiving anything (safe default). One open
  session per project (`409 sync_in_progress` otherwise).
- Idempotent per `Idempotency-Key` header (required, ≤128 chars, kept 24 h):
  same key + same body hash → cached response; same key + different body →
  `409 idempotency_mismatch`. Only 200 responses are cached: 409/422/423
  depend on state the plugin fixes before retrying with the same key.
- Validation: duplicate `sourceId` in a batch → `422 validation` with the
  index; unknown fields ignored; strings capped (title 512, tags 50 × 64,
  images 30 per product, descriptionHtml 64 KiB).
- Plan limit: if the upsert would exceed `limits.maxProducts` (pricing.json
  `plans.<id>.productLimit`, read through `maxProductsForPlan`) the whole
  batch is rejected `422 plan_limit` (`details.maxProducts`, `current`, `incoming`).
- Concurrency: a MySQL advisory lock per project (`GET_LOCK('osl:sync:<id>', 5)`)
  serialises batches; `423 locked` if it cannot be acquired in 5 s.
- Response: `{ inserted, updated, archived, unchanged, session?, errors: [{index, sourceId, code}] }`.
- Side effects: `projects.source` set from `X-OSL-Platform` on first sync
  when unknown; no audit is launched automatically (the plugin or the
  merchant triggers it — audits cost worker time).

### `DELETE /products/{sourceId}` — `catalog:write`
Archives (never hard-deletes — generation history must survive). 404 if unknown, 200 idempotent if already archived.
Response: `{ sourceId, status: "archived", alreadyArchived }`.

### `GET /changes?since=<cursor>&limit=<1..200>` — `changes:read`
Approved changes not yet acknowledged, oldest first:
```json
{ "changes": [{ "id", "productSourceId", "field": "title|description|tags|images",
                "value": string | string[] | [{src, alt}],
                "sourceJobId", "approvedAt", "expiresAt"? }],
  "nextCursor": "…" | null }
```
- Cursor = last change id (ULID, time-ordered). `since` omitted → from the
  beginning of unacknowledged changes.
- Image values are R2 CDN URLs valid until `expiresAt` (plan retention);
  the plugin must copy the file, never hot-link.
- A change stays listed until acked, cancelled by the merchant, or expired.

### `POST /changes/{id}/ack` — `changes:ack`
```json
{ "status": "applied" | "failed" | "skipped", "error"?: string,
  "storeUpdatedAt"?: iso, "storeValueHash"?: sha256 }
```
- Idempotent: acking an already-acked change with the same status → 200; a
  different status → `409 already_acked`.
- **Conflict detection**: if the plugin reports `storeValueHash` of the field
  *before* applying and it differs from the hash OSL had at approval time,
  OSL marks the change `conflict` instead of `applied` and surfaces it in the
  dashboard ("modified in the store since"); the plugin should not apply
  when `conflict` is returned. Plugins that cannot hash simply omit it.
- Acks from another project → 404 (no existence leak).

### Rate limits (per key, token bucket in the web process)
`products/sync` 30/min, `changes` 120/min, `ack` 240/min, everything else
60/min. Single-instance deployment → in-memory buckets are exact; when the
app runs on several instances move the bucket to MySQL/Redis (documented
seam: `shared/api/rate-limit.ts`).

### Reference client
`scripts/integration-client.ts` (`pnpm tsx scripts/integration-client.ts --key osl_live_… [--base URL] site | sync '<json>' | changes [since] [limit] | ack <id> <status>`)
signs requests exactly as above and is the copy-paste example for plugin
authors: `signedFetch()` is the whole client contract (bearer + `X-OSL-Signature`
over the pathname, `Idempotency-Key` on sync).

## 4. Data model (drizzle, `src/shared/db/schema.ts`)

- `api_keys`: id, projectId (FK cascade), userId, name, prefix (unique),
  keyHash (sha256 hex, unique), permissions json, expiresAt, revokedAt,
  rotatedToId, graceUntil, lastUsedAt, lastUsedIp, createdAt.
- `api_key_events`: id, apiKeyId, kind (created|rotated|revoked|expired|auth_failed), ip, at, meta json.
- `api_idempotency`: key (pk: sha256(apiKeyId + idemKey)), bodyHash, status, responseJson, createdAt (TTL 24 h, swept by the worker).
- `catalog_sync_sessions`: id, projectId, seenSourceIds json, startedAt, expiresAt, closedAt.
- `product_changes`: id (ULID), projectId, productId, productSourceId, field, value json, valueHash (sha256 of the new value), **priorValueHash** (sha256 of the store field at approval time — what `storeValueHash` is compared against), sourceJobId, status (pending|applied|failed|skipped|conflict|cancelled|expired), approvedBy, approvedAt, ackedAt, ackPayload json, expiresAt.

"Approved change" is new product behaviour: on the product page the merchant
clicks **Apply to store** on a generation → `product_changes` row (feature
`apply-to-store`). Without a connected plugin the row is still useful (it is
the merchant's "to apply" list); with one, the plugin picks it up.

## 5. Security checklist
TLS only; bearer + HMAC signature; keys hashed at rest; constant-time
compare; no CORS; per-key + per-IP rate limits; body size cap; strict zod
validation; ids never enumerable (ULID/UUID, 404 on foreign resources);
audit trail (`api_key_events`); secrets never in logs; keys tied to
`projects.userId` ownership; deleting the project revokes; CSP untouched
(no browser use). Threats considered: key leak (rotate + grace), replay
(timestamp window), tampering (signature over body hash), enumeration
(uniform 401/404), abuse (rate limits, plan limits), poisoning (validation,
caps, HTML sanitised on render as today).

## 6. Performance & scalability
Batches of 200 in one transaction reuse `syncProjectProducts` (single
select per project + bulk upsert); full sync of 5 000 products = 25 requests
≈ under a minute. Indexes: `api_keys.prefix`, `product_changes(projectId, status, id)`,
`api_idempotency.createdAt` (sweep). Worker sweeps idempotency rows and
expired sync sessions hourly (rides the existing tick). Cursors are ULIDs so
listing is index-only. Nothing in the hot path calls the AI providers.

## 7. Maintainability (FSD placement)
- `entities/api-key`: key generation, hashing, verification, signature,
  lifecycle (rotate/revoke/expire), events.
- `entities/product-change`: table + guarded status transitions (same
  pattern as `generation-job` transitions).
- `shared/api`: error envelope, rate limit, idempotency, zod body parsing;
  `withSiteKey()` (auth + signature + rate limit + permission) lives in
  `entities/api-key` because `shared` may not import entities.
- `features/integrations`: key management (server actions + `ui/`) shown in
  site settings; `features/apply-to-store`: the "Apply to store" action + UI.
- `views/dashboard-site` gets an **Integrations** tab; `app/api/v1/**` routes
  are thin (parse → helper → entity).
- Tests: unit (key format/hash/signature/cursor/validation), DB (lifecycle,
  sync partial/full/archive, idempotency, changes+ack+conflict, permissions,
  revocation mid-flight), e2e (create a key in the UI, call `/site`).
- Versioning: path `/v1`; breaking changes → `/v2`; additive fields are not
  breaking. `docs/api/openapi.yaml` is the machine-readable contract.

## 8. Phases
1. **This delivery**: schema, entities, shared/api helpers, all v1 routes,
   key management UI, Apply-to-store, tests, OpenAPI.
2. WooCommerce plugin (separate repo) — pushes catalog on product save,
   polls `/changes` every 5 min via WP-Cron, applies, acks.
3. Shopify connector: custom-app Admin token stored on OSL, OSL pulls
   products + applies changes through the Admin API (no plugin).
4. Outbound webhooks (`change.approved`) with HMAC, retries, dead-letter.
5. Wix app.

## 9. Merchant onboarding (guided setup — merchants are not technical)

The Integrations tab of a site is a **wizard**, not a settings form:

1. **Choose your platform** (Shopify / WooCommerce / Wix, auto-selected from
   the audit's detected platform, changeable).
2. **Numbered steps with a screenshot each**, written in plain language,
   every value the merchant has to copy shown in a box with a Copy button,
   every place they have to click named exactly as in their admin
   (localised: 13 locales, screenshots in EN with callouts).
   - WooCommerce: install the OSL plugin (upload the zip → Activate) → open
     *OneShopLab* in the WP menu → paste the site key → Save. Estimated 3 min.
   - Shopify (phase 3 connector): Settings → Apps → *Develop apps* → Create
     app → Admin API scopes (exact list shown) → Install → copy the token →
     paste it in OSL. Estimated 5 min. Until the connector ships the step
     shows "Bientôt disponible" with a "notify me" toggle.
   - Wix: "Bientôt disponible" with the same toggle.
3. **Your site key** — generated at this step (not before), shown once with
   Copy + "I saved it"; the page explains it is a password, that it can be
   regenerated, and never asks the merchant to understand hashing/HMAC.
4. **Connection check** — a live card polls `lastUsedAt` and turns green
   ("Connecté — dernier échange il y a 12 s, 148 produits synchronisés") on
   the plugin's first call. No manual "test" button needed; a "Something's
   wrong?" link expands the 3 most common fixes (key pasted with a space,
   plugin not activated, site under maintenance mode).
5. **After setup**: the tab shows sync status, pending changes to apply,
   and the key actions (Rotate / Revoke) behind a confirmation that explains
   what happens to the plugin.

Copy tone: second person, short sentences, no jargon ("clé du site" not
"API key", "connexion" not "webhook"). Every string lives in
`messages/*.json` under `Integrations.*`; screenshots in
`public/integrations/<platform>/step-<n>.png` (placeholders allowed until the
plugin exists, tracked in docs/ADOPTION.md).

Implemented 2026-08-30 as `features/integrations` (wizard, `?tab=integrations`)
and `features/apply-to-store` (button on each past generation + the
"changes to apply" list). The "notify me" toggle is stored in
`projects.integration_interest` (json `{ shopify?, wix? }`).

### Screenshots to produce (replace the grey placeholders)

800×450 PNG, English admin, callout on the element to click, no personal
data. Path = `public/integrations/<platform>/step-<n>.png`.

- [ ] `woocommerce/step-1.png` — Plugins › Add New › Upload Plugin with the zip selected
- [ ] `woocommerce/step-2.png` — "Activate Plugin" button after install
- [ ] `woocommerce/step-3.png` — OneShopLab menu entry + the Site key field
- [ ] `woocommerce/step-4.png` — Save button and the green status inside the plugin
- [ ] `shopify/step-1.png` — Settings › Apps and sales channels › Develop apps
- [ ] `shopify/step-2.png` — Create an app dialog with the name filled
- [ ] `shopify/step-3.png` — Admin API scopes with read_products / write_products ticked
- [ ] `shopify/step-4.png` — Install app → Reveal token once
- [ ] `shopify/step-5.png` — OSL token field (ships with the phase-3 connector)
- Wix: no screenshots until the app exists (phase 5).
