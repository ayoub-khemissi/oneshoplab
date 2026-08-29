---
status: acted
implemented: partial
last-verified: 2026-08-29
---

# Guidelines adoption — snapshot

Point-in-time. Re-verify the numbers when you touch a line; the rules themselves are in [GUIDELINES.md](GUIDELINES.md).

## Gates

| Gate | Status | Notes |
|---|---|---|
| Lint (0 errors) | ✅ | Flat ESLint config since 2026-08-29 (`next lint` had been broken since the Next 16 migration). |
| Lint (0 warnings) | 🟡 28 | 19 `react-hooks/set-state-in-effect`, 4 `react-hooks/refs`, 2 `react-hooks/purity`, 3 unused vars. Ratchet: this number must only go down. |
| Typecheck | ✅ | |
| i18n parity + usage | ✅ | 13 locales, 933 keys, 972 static calls checked. Found 2 real holes on day one (crash-level). |
| Format | ✅ | One-time `prettier --write` on 2026-08-29; hooks keep it. |
| Audit (critical) | ✅ | 46 → 1 low (`@babel/core` transitive, build tooling). |
| Schema ↔ migrations | ✅ | `drizzle-kit check` clean after drizzle-orm 0.45. |
| Tests | ⚪ | None. Phase 2: vitest on the ledger, pricing snapshot, job state machine, webhook idempotency, provider fallback. |
| CI | ✅ | `.github/workflows/ci.yml` on push/PR. Deploy stays manual via `scripts/deploy.sh`. |
| Backups | ⛔ | No DB dump for this app on the box (the other sites have one). Highest-priority ops gap. |

## Oversized files (max-lines ratchet)

| File | Lines | Plan |
|---|---|---|
| `src/app/[locale]/dashboard/sites/[siteId]/page.tsx` | 1390 | Split into sections (overview, products table, activity, share) as server components. |
| `src/components/bulk-generate-section.tsx` | 1102 | Extract wizard steps + progress panel; keep one container. |
| `src/lib/bulk/site-generate.ts` | 911 | Split planning (cost/selection) from execution (queueing/workers). |
| `src/app/[locale]/dashboard/sites/[siteId]/products/[id]/page.tsx` | 830 | Extract image/text panels. |
| `src/app/[locale]/privacy/page.tsx` | 607 | Static legal content — accepted deviation (documented). |

## Known deviations (accepted, dated)

- **In-place build on the production box** — during `pnpm build` (~60 s) the running server can 500 on routes whose manifest is being rewritten. Accepted for now; mitigation = build into a separate directory / blue-green when traffic justifies it (2026-08-29).
- **`nodemailer` 9 with next-auth's peer range `^7 || ^8`** — the email provider of next-auth is not used; the peer warning is cosmetic (2026-08-29).
- **Legal pages are English-only** and hand-written; the AI sub-processor rows are generated from `pricing.json`.

## 2026-08-29 — Phase 2 (tests)

- vitest introduced: 31 tests / 4 files (~11 s). Coverage targets: credit
  ledger, pricing snapshot, provider fallback, Stripe webhook idempotency.
- Not yet covered: job state machine — transitions are spread over 8 files
  (`persist-result`, `retry-job`, `optims`, `dynamic-audit`, watchdogs…); to
  test it, first extract a single `transitionJob(from → to)` helper (Phase 3).
- Also: encrypted MySQL backups + weekly restore drill (see GUIDELINES → Backups).

## 2026-08-29 — Phase 3 (structure)

- `transitionJob()` is the single writer of `jobs.status` (17 call sites
  migrated in 8 files); +10 tests.
- Split: `dashboard/sites/[siteId]/page.tsx` 1582 → 7 files (max 482),
  `products/[id]/page.tsx` 989 → 8 files (max 269),
  `components/bulk-generate-section.tsx` 1206 → 6 files (max 420),
  `lib/bulk/site-generate.ts` 1152 → see `src/lib/bulk/`.
- Import boundaries enforced (no-restricted-imports) + `pnpm deps:circular`
  (1 cycle found and broken: auth-actions ↔ audit/launch).
- Still > 600 lines (next candidates): `retryable-generate.tsx` 780,
  `db/schema.ts` 751 (leave — one schema file is deliberate), `leads/discovery.ts`
  717, `ai-image-grid-live.tsx` 675, `share/queries.ts` 636, `share-links-card.tsx` 626.
  `max-lines` stays a warning until those are done.

## 2026-08-29 (late) — Phase 3 done, Phase 5 partial

- All 10 oversized files split; `max-lines` (600) is now an **error**, with
  `src/lib/db/schema.ts` as the single explicit exception.
- Monitoring: `/api/health` + `scripts/ops/healthcheck.sh` (cron 5 min →
  Discord). Still missing: an **external** uptime monitor (needs an account
  outside the box) and error tracking (Sentry — needs a DSN; decide first).
- CSP shipped **report-only**; review `[csp-report]` logs after a week
  before enforcing.
- Test campaign on business features done: 124 tests / 15 files (~33 s).
  Not yet covered: store adapters (Shopify/Woo/Wix normalisation — needs
  fixtures), signup via next-auth `createUser` (framework-bound), legal
  consent params (next-intl request context), dynamic audit / bulk pipeline.
