# FSD layers (migration in progress)

```
src/app       App layer: Next.js routing, layouts, providers, global styles — page.tsx = one line rendering a view
src/views     Pages layer (named `views`: `src/pages` would be read as Next's Pages Router) — one slice per
              route, composing widgets/features/entities; page-local `_components`/`_lib` live here
src/widgets   self-contained blocks reused across views (dashboard sections, header) — may use features + entities + shared
src/features  one user action each (share-link/, contact/, audit-launch/…) — may use entities + shared
src/entities  domain models + their data access (user/, project/, product/, audit/, job/, credit/) — may use shared only
src/shared    framework glue and primitives with no domain meaning (db, ui, i18n, config, lib utils)
```

Rules (enforced by ESLint `no-restricted-imports`, see eslint.config.mjs):

- layer order: app → views → widgets → features → entities → shared; a layer imports only from layers **below** it; never sideways between slices of the same layer
  (`features/share-link` must not import `features/contact`);
- every slice exposes a single `index.ts` — importers use `@/features/share-link`, never deep paths.
  Two documented exceptions in `shared`: `@/shared/db/schema` (tables/types/enum constants — a
  separate module from the pool so `src/components` can import types while ESLint forbids
  `@/shared/db`, and so `drizzle.config.ts` / `vi.mock` point at one file) and
  `<slice>/client` — a second, client-only barrel for a slice whose `index.ts` opens the db or
  uses server-only APIs (`@/shared/recaptcha/client`, `@/entities/notification/client`); a
  server barrel must never re-export a client component, or the worker/server import graph
  loads React/next-intl client code;
- `src/lib` and `src/components` are **legacy** until empty: new code goes in a slice, and touching
  a legacy module is the moment to move it. Progress is tracked in docs/ADOPTION.md.

## Server/client boundary inside a slice

A slice's `index.ts` is the **server** public API: it may re-export db-bearing
modules, Stripe, `next/headers`… A client component (`'use client'`) in another
slice must never import that barrel. Two dedicated entries exist for that:

- `@/features/<slice>/actions` — a plain module re-exporting only the `'use server'` files with the
  slice's server actions (client forms/buttons import from here);
- `@/<layer>/<slice>/client` — client-safe UI/helpers (e.g. `@/entities/notification/client`,
  `@/shared/recaptcha/client`) when a slice ships both server code and client UI.

ESLint allows exactly these two deep paths. Symptom when you get it wrong:
Turbopack "You're importing a module that depends on next/headers…" or
"Can't resolve 'net'/'tls'" at build time — run `NEXT_DIST_DIR=.next-e2e pnpm build`
locally to see the import chain.
