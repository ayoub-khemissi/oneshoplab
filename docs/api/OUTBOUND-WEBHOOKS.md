# Outbound webhooks (phase 4) — OSL → plugins/integrators

Status: spec v1, 2026-08-30. Lets a plugin (or any integrator) react
immediately instead of polling `/changes` every 5 minutes.

## Model
- `outbound_webhooks`: id, projectId (FK cascade), url (https only, no
  private/loopback ranges — SSRF guard resolved at save time AND at send
  time), secret (sealed, shown once like a site key), events json
  (`change.approved`, `change.cancelled`, `sync.completed`, `sync.failed`,
  `connection.status_changed`), enabled, createdBy, createdAt, lastDeliveryAt,
  lastStatus, failureStreak, disabledAt (auto-disabled after 50 consecutive
  failures or 7 days of failures; the merchant is notified — bell + email
  kind `integration_webhook_disabled`).
- `webhook_deliveries`: id (ULID), webhookId, eventId (ULID, shared by all
  deliveries of one event), event, payload json, attempt, status
  (pending|delivered|failed|dead), responseStatus, responseBody (first 1 KiB),
  nextAttemptAt, deliveredAt, createdAt. Retention 14 days (worker sweep).

## Delivery
- `POST url` with headers `X-OSL-Event`, `X-OSL-Event-Id`, `X-OSL-Delivery-Id`,
  `X-OSL-Timestamp`, `X-OSL-Signature: v1=<hex HMAC-SHA256(secret, "${ts}.${rawBody}")>`,
  `User-Agent: OneShopLab-Webhooks/1`, JSON body
  `{ id, event, createdAt, projectId, data: {...} }` (for `change.approved`:
  the same object as `GET /changes` returns).
- Timeout 10 s; 2xx = delivered; anything else (or network error) → retry
  with exponential backoff 1 min, 5, 30, 2 h, 12 h (5 attempts) then `dead`.
- Ordering is not guaranteed; receivers must be idempotent on `X-OSL-Event-Id`.
- The worker drains due deliveries every tick (batch 50, concurrency 5, per
  host serialised).
- "Send a test event" button → `ping` event, result shown inline.

## Receiver reference (WooCommerce plugin ≥ 1.1)
`POST /wp-json/oneshoplab/v1/webhook`: verify signature with the stored
webhook secret (constant-time), check timestamp ±5 min, dedupe by event id
(transient 24 h), then trigger an immediate `/changes` pull (the plugin
never applies from the payload — the pull is the single write path).

## UI (Integrations tab → "Avancé")
Plain language: "Recevoir les changements immédiatement" — the WooCommerce
plugin registers its URL automatically when the merchant saves the site key
(the plugin calls `PUT /api/v1/webhooks/self` with its endpoint; OSL creates
the webhook and returns the secret once; the plugin stores it). Manual entry
is only shown for "other integrations" with the URL/secret fields and the
delivery log (last 20: date, event, status, response code).

## API additions (v1, key permission `webhooks:manage`)
`PUT /api/v1/webhooks/self { url, events? }` → `{ id, secret }` (idempotent
per url: re-PUT rotates the secret), `DELETE /api/v1/webhooks/self`,
`GET /api/v1/webhooks/self/deliveries?limit=`.

## Placement
`entities/outbound-webhook` (tables, SSRF guard, signing, delivery state
machine), `features/webhook-delivery` (worker drain + retries + auto-disable
+ notification), `features/integrations` UI section, routes
`app/api/v1/webhooks/self*`, plugin update in the sibling repo.
