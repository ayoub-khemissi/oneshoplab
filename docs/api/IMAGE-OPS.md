# Product image operations (v1.1 of the changes protocol)

Status: spec, 2026-08-31. Fixes a real hazard found during the WooCommerce QA:
applying an `images` change **replaces the merchant's whole gallery**
(`set_image_id` + `set_gallery_image_ids`), and the OSL UI offers no way to say
"just the main photo" or "add this one". A merchant with six curated photos who
generates three lifestyle shots loses the six. This spec makes OSL mirror what
the merchant can already do in their own admin, precisely and reversibly.

## 1. Image identity (prerequisite)

`ProductImage` gains an optional stable id from the store:

```ts
interface ProductImage { src; alt; width; height; position; sourceImageId?: string | null }
```

- WooCommerce plugin: the attachment id (it already reads it, it just never sent it).
- Shopify: the media id (`gid://shopify/MediaImage/…`). Wix: the media id.
- Absent (old plugin, scraped catalog) → the store cannot be addressed precisely;
  OSL falls back to §5.

## 2. Change payload

`product_changes.field = 'images'` keeps its meaning ("the product's images
changed") but the value becomes an **ordered operation list** instead of a bare
array:

```json
{ "v": 1, "ops": [
  { "op": "set_featured", "image": { "src": "https://cdn…", "alt": "…" } },
  { "op": "append",       "image": { "src": "…", "alt": "…" } },
  { "op": "replace",      "target": "<sourceImageId>", "image": { "src": "…", "alt": "…" } },
  { "op": "remove",       "target": "<sourceImageId>" },
  { "op": "set_alt",      "target": "<sourceImageId>", "alt": "Mug en grès sur une table en bois" },
  { "op": "reorder",      "order": ["<id|new:0>", "<id>", "…"] }
] }
```

Rules: ops apply in order; `new:<n>` refers to the n-th image introduced earlier
in the same list (so `reorder` can place a freshly appended image); an op whose
`target` no longer exists in the store is **skipped, not fatal** and reported in
the ack (`skippedOps`); `remove` never deletes the media file, it only detaches
it from the product; a change may not remove the last remaining image (the store
would show a placeholder) — the server rejects it at creation.

Backward compatibility: a plain array value (the current shape) stays valid and
means "replace everything" — old plugins keep working, and OSL keeps sending
that shape to connections that never reported `sourceImageId`.

## 3. Reversibility

`product_changes` gains `prior_value` (json, next to the existing
`prior_value_hash`): the field's value **before** applying, captured at approval
time — for images, the full ordered list with ids. That powers:

- "Annuler" in the UI → creates a reverse change (`ops` computed from
  `prior_value`, or the plain array for the fallback path);
- an honest before/after preview;
- a clear conflict message ("la photo principale a changé dans votre boutique
  depuis l'approbation").

Text fields (`title`, `description`, `tags`) get `prior_value` too — same
"Annuler" affordance, same cost: one column.

## 4. UI (product page)

One grid mixing **the store's images** and **OSL generations**, each tile
carrying the actions a merchant has in their own admin: *Définir comme
principale*, *Ajouter à la galerie*, *Remplacer cette image*, *Retirer du
produit*, *Modifier le texte alternatif*, plus drag-to-reorder. Every action
queues an op; the merchant reviews the resulting list ("3 modifications en
attente") and applies in one click. Destructive ops are named in plain words
before applying, and "Annuler" stays available after.

Alt text is a first-class action: it is the safest SEO win (our own audit
penalises missing alt) and never risks the merchant's visuals.

## 5. Fallback when the store cannot be addressed precisely

If the connection never reported `sourceImageId` (old plugin, Wix pre-ids), the
UI keeps a single "Remplacer toutes les images" action, and it must state
exactly what disappears: "Vos 6 photos actuelles seront retirées du produit et
remplacées par les 3 visuels générés. Elles resteront dans votre médiathèque."
No silent replace-all, ever — this guardrail ships first, before the ops.

## 6. Rollout order

1. **Guardrail** — explicit confirmation naming the consequence (app only).
2. **Protocol** — `sourceImageId` end to end, `ops`, `prior_value`, "Annuler",
   plugin + Shopify + Wix executors, openapi + spec, plugin minor version.
3. **Editor** — the grid with per-image actions and reordering.

Each step ships independently; step 1 is safe on its own, step 2 keeps old
plugins working, step 3 is pure UI on top of the protocol.

## 7. Provider-agnostic contract (WooCommerce, Shopify, Wix, and the next ones)

Nothing in §2 names a platform: `sourceImageId` is an opaque string owned by the
store (WP attachment id, Shopify `gid://…/MediaImage/…`, Wix media id, whatever
comes next), ops are verbs a storefront admin already has, and the payload is
executed by **one interface per provider**, not by branching:

```ts
interface ImageOpsExecutor {
  readImages(productSourceId): Promise<ProductImage[]>;      // for prior_value + conflict
  applyOps(productSourceId, ops): Promise<{ skippedOps: string[] }>;
}
```

The plugin implements it in PHP behind `/changes` + ack; OSL-driven connectors
(Shopify, Wix) implement it in TypeScript behind the shared apply loop already
in `entities/product-change/api/apply-loop.ts`. A new provider = one executor +
one mapper, no schema and no UI change.

**Capabilities, declared not assumed.** Every connection reports what it can do,
and the UI offers exactly that — never a button that silently does nothing:

```json
{ "stableImageIds": true,
  "imageOps": ["set_featured","append","replace","remove","set_alt","reorder"],
  "maxImages": 30, "altEditable": true }
```

- WooCommerce plugin: sent with its calls (it knows its own WooCommerce version);
  a plugin older than the ops release reports nothing → §5 fallback.
- Shopify / Wix: known statically by their connector, versioned with it.
- Unknown provider or missing field → assume the minimum (`stableImageIds:false`,
  replace-all only). Degrading is always safe; pretending is not.

The same capability object carries the text side (`fields: ['title','description','tags']`),
so a future provider that cannot write descriptions simply doesn't show the action.
