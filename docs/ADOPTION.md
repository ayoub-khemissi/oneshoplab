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
| Lint (0 warnings) | 🟡 34 | 19 `react-hooks/set-state-in-effect`, 4 `react-hooks/refs`, 2 `react-hooks/purity`, 4 unused vars, 5 `max-lines`. Ratchet: this number must only go down. |
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
