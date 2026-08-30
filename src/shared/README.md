# FSD layers (migration in progress)

```
src/app       Next.js routes only — page.tsx composes widgets/features; no business logic
src/widgets   self-contained page blocks (dashboard sections, headers) — may use features + entities + shared
src/features  one user action each (share-link/, contact/, audit-launch/…) — may use entities + shared
src/entities  domain models + their data access (user/, project/, product/, audit/, job/, credit/) — may use shared only
src/shared    framework glue and primitives with no domain meaning (db, ui, i18n, config, lib utils)
```

Rules (enforced by ESLint `no-restricted-imports`, see eslint.config.mjs):

- a layer imports only from layers **below** it; never sideways between slices of the same layer
  (`features/share-link` must not import `features/contact`);
- every slice exposes a single `index.ts` — importers use `@/features/share-link`, never deep paths;
- `src/lib` and `src/components` are **legacy** until empty: new code goes in a slice, and touching
  a legacy module is the moment to move it. Progress is tracked in docs/ADOPTION.md.
