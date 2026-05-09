# CLAUDE.md

Guidance for Claude when working in this repo. The full project overview lives
in `README.md` — read it for stack, deployment, and env-var details. This file
captures the conventions, landmines, and workflow rules that aren't obvious
from the code.

## What this is

OneShopLab — Next.js 16 (App Router) SaaS that audits Shopify / WooCommerce /
Wix / manual product catalogs and bills generation through a credit ledger.
Production runs on a single OVH box: `nginx → next start (PM2) + tsx worker (PM2)`.

## Commands

Always use **pnpm**, never npm or yarn. Lockfile is `pnpm-lock.yaml`.

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm worker:dev       # background worker (separate terminal — required for audits/jobs)
pnpm typecheck        # tsc --noEmit — run after non-trivial TS changes
pnpm lint             # next lint
pnpm db:generate      # create a new migration from drizzle schema diff
pnpm db:migrate       # apply pending migrations
```

There is no automated test suite. Verification = `pnpm typecheck`, `pnpm lint`,
and manual QA. If you can't reproduce a UI change in the browser, say so
explicitly rather than declaring it done.

## Path alias

`@/*` → `src/*` (see `tsconfig.json`). Prefer alias imports over deep relative
paths inside `src/`.

## Landmines (things that will silently break if you do them wrong)

### Credits — never touch `users.creditsBalance` directly

`creditsBalance = creditsBalanceSubscription + creditsBalancePack`. The sum is
maintained by `applyCreditTransaction` in `src/lib/credits.ts`. All grants and
debits go through that helper (it writes the `credit_transactions` audit row
and updates both buckets atomically). Direct UPDATEs to `creditsBalance`
desync the buckets and corrupt the ledger.

### Worker entry must stay `.mts`

`src/worker/index.mts` uses top-level `await import()` to delay loading
audit-runner / kie-watchdog until after `loadEnv()` runs. tsx defaults to a
CJS transform target (which forbids top-level await); the `.mts` extension
forces the ESM transform. Don't rename it to `.ts` or wrap the entry in a
function.

### `next.config.ts` — do NOT add `output: 'standalone'`

Tried and reverted (see README "Why we don't use standalone"). Standalone
bakes the bind hostname into middleware-rewrite URLs, so behind nginx Next
tries to TLS-handshake itself on the plain-HTTP upstream port and 500s with
EPROTO. Keep `pm2 start … next start` as the prod boot path.

### Locale routing is `always` prefixed — keep it that way

`src/i18n/routing.ts` uses `localePrefix: 'always'`. `'as-needed'` loops
behind a reverse proxy (`/` → `/en` → `/`). 13 locales live in `messages/`
(en/fr/es/de/it/pt/ru/pl/tr/ar/zh/ja/ko). Adding a new translation key means
adding it to **all 13 files** — `next-intl` errors at runtime on missing keys
in the matched locale.

### Stripe webhook is the source of truth for plan + monthly credit grants

Don't write plan changes from anywhere except `/api/stripe/webhook`. Manual
plan flips for testing go through `scripts/set-plan.ts`.

### kie.ai pricing — `CREDIT_MARKUP_FACTOR`

Credits debited per generation = raw kie cost × `CREDIT_MARKUP_FACTOR`
(default 2.5, clamped [1, 10]). Pricing logic is centralized in
`src/lib/ai/models.ts` (`chatCreditsToDebit`, `costForImage`,
`PLAN_TIERS`). Don't hardcode credit costs at call sites — go through these
helpers so a markup change propagates.

## Code conventions

- **TypeScript strict** is on. No `any` unless there's a comment explaining
  why a `unknown` + narrow won't work.
- **Server components by default.** Only add `'use client'` when the file
  needs hooks, browser APIs, or event handlers.
- **Server actions** for mutations (see `src/lib/auth-actions.ts`,
  `src/lib/stripe-actions.ts` for the pattern). Validate input with `zod`.
- **Drizzle queries** colocate near the feature, not in a giant `queries.ts`.
  Schema is the single source of truth in `src/lib/db/schema.ts`.
- **Adapters** (`src/lib/adapters/`) implement the same `StoreAdapter`
  interface — when adding a platform, mirror the existing `shopify.ts` /
  `woocommerce.ts` / `wix.ts` shape.
- **Comments**: only when the *why* is non-obvious (a workaround, an
  invariant, a foot-gun). Don't narrate *what* the code does.

## What NOT to commit

- `.env` (already in `.gitignore`)
- `data/` (local SQLite/uploads, also gitignored)
- `tools/email-scraper/` has its own `package.json` and deps — don't mix it
  into the main app's `package.json`.

## Useful entry points when investigating

- Audit pipeline: `src/lib/audit/run.ts` → `process.ts` → `score.ts`
- Generation: `src/lib/ai/kie.ts` (client) + `prompts.ts` + `optims.ts`
- Job queue: `src/worker/audit-runner.ts` and `src/worker/kie-watchdog.ts`
- Pricing/plans: `src/lib/ai/models.ts` (`PLAN_TIERS`, credit costs)
- Storage: `src/lib/storage/r2.ts` (TLS 1.3 forced — don't relax it)

## Admin one-shots

```bash
tsx scripts/set-plan.ts user@example.com pro     # flip a user's plan
tsx scripts/claim-audit.ts <audit-id> <user-id>  # bind anon audit to a user
tsx scripts/reconcile-kie-jobs.ts                # walk pending kie jobs (also: pnpm reconcile)
tsx scripts/refresh-audit-summary.ts             # recompute cached aggregates
```
