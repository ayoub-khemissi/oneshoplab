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

### AI models + pricing — `pricing.json` is the ONLY place to edit

`pricing.json` (repo root) is the single catalog: for every model its
upstream ids (`openrouterId` primary, `kieModelId` fallback), display name,
provider, tier, tagline and rates; the default model; `chatModelAliases`
for retired ids; `systemChatModels` (fast/quality, used by suggestions and
the dynamic audit); the image family + qualities; `imageFallbackModel`; and
the two markups (`chatMarkupFactor` for text — 2.0, `creditMarkupFactor` for
images — 3.5, env-overridable via `CREDIT_MARKUP_FACTOR`). Rates are USD/M
tokens in units of `providerUnitUsd` (0.005 $): $2/M → 400.

User-facing prose about a model (tier badge, tagline, image-quality label)
is translated under `Models.*` in `messages/*.json`, keyed by catalog id, and
read through `useModelCopy()` with a fallback to the English text in
`pricing.json` — model NAMES themselves are never translated. When you add
a model, add its `Models.chat.<id>.tagline` (and `quality.<id>.*` for image
tiers) in the locales you care about; the rest shows English until then.

Credits debited = field token cap × rate × markup (`estimateChatCredits`)
or flat cost × markup (`costForImage`) in `src/lib/ai/models.ts`. Never
hardcode credit costs or model ids at call sites; never mention a model
name in `messages/*.json` — use the `{budgetModel}`/`{imageModel}`… placeholders
fed by `modelNamesForCopy()`. Rebuild + restart web and worker after editing.

**Swapping a model:** change its entry in `pricing.json`; if the *id* changes,
add the old id to `chatModelAliases` AND append the new id to
`CHAT_MODEL_IDS` in `src/lib/db/schema.ts` (MySQL enum for
`users.preferred_chat_model` — additive, then `pnpm db:generate && pnpm db:migrate`).

**Providers:** text goes through `src/lib/ai/chat-provider.ts` (OpenRouter,
`OPENROUTER_API_KEY`, one retry, then kie fallback). Images go through kie
(`startImageOptim`); when kie fails, `persistKieJobFailure` first tries
`src/lib/ai/image-fallback.ts` (OpenRouter `imageFallbackModel`) and only then
fails + refunds. Reasoning is disabled on text calls on purpose — Sonnet 5
reasons by default and its hidden tokens eat `max_tokens` (empty titles).

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
- Generation: `src/lib/ai/chat-provider.ts` (OpenRouter→kie) + `kie.ts` (images) + `prompts.ts` + `optims.ts`; catalog in `pricing.json`
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
