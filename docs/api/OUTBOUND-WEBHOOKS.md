# Outbound webhooks (phase 4) — OSL → plugins/integrators

Status: spec v1, 2026-08-30 — backend implemented 2026-08-30 (migration
`0030_outbound_webhooks`; UI section pending). Lets a plugin (or any integrator) react
immediately instead of polling `/changes` every 5 minutes.

## Model
- `outbound_webhooks`: id, projectId (FK cascade), url (https only, no
  private/loopback ranges — SSRF guard resolved at save time AND at send
  time), secret (sealed, shown once like a site key), events json
  (`change.approved`, `change.cancelled`, `sync.completed`, `sync.failed`,
  `sync.requested`, `connection.status_changed`), enabled, createdBy, createdAt, lastDeliveryAt,
  lastStatus, failureStreak, failingSince (start of the current streak — the
  7-day clock), disabledAt (auto-disabled after 50 consecutive failures or
  7 days of failures; the merchant is notified — bell + email kind
  `integration_webhook_disabled`), kind (`self` = registered by the plugin
  through `/webhooks/self`, one per project; `manual` = other integration,
  one per url), urlHash (unique per project). `ping` deliveries never count
  towards the streak. Deliveries of a disabled webhook are marked `dead`.
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

## `sync.requested` (added 2026-08-31)
OSL is about to score this project's catalog (an audit run) and wants it
fresh: `{ reason: "audit", requestedAt }`. The receiver should push a
`POST /products/sync` now — the audit waits at most ~20 s, then scores
whatever the table holds, so a store that stays silent only ever produces a
slightly older report. Shopify/Wix connections are not concerned (OSL pulls
them itself through `pullRequestedAt`).

The event list of a webhook is stored at registration time: a plugin that
registered before this event existed is **not** subscribed to it and hears
nothing until it re-registers (`PUT /api/v1/webhooks/self`). Adding an event
needs no migration — `outbound_webhooks.events` is JSON and
`webhook_deliveries.event` a varchar.

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
per url: re-PUT rotates the secret — 200; a new url replaces the endpoint —
201; 422 `validation` with `details.reason` ∈ not_https | invalid_url |
blocked_host | private_address | dns_failed), `DELETE /api/v1/webhooks/self`,
`GET /api/v1/webhooks/self/deliveries?limit=` (≤ 100, default 20, newest
first, no payloads), `POST /api/v1/webhooks/self/ping` → 202 `{ deliveryId }`.

Server actions for the UI (`@/features/webhook-delivery/actions`):
`listWebhooksAction`, `listDeliveriesAction`, `createManualWebhookAction`
(secret once), `deleteWebhookAction`, `sendPingAction`.

## Placement
`entities/outbound-webhook` (tables, SSRF guard, signing, delivery state
machine), `features/webhook-delivery` (worker drain + retries + auto-disable
+ notification), `features/integrations` UI section, routes
`app/api/v1/webhooks/self*`, plugin update in the sibling repo.
