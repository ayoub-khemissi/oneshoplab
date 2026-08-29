---
status: acted
implemented: partial
last-verified: 2026-08-29
---

# Technical guidelines

Rules for working on this codebase. `MUST` = blocks a merge / a deploy; `SHOULD` = strong default, deviations are stated in the commit or PR. The state of adoption is a dated snapshot in [ADOPTION.md](ADOPTION.md) — this file only holds the rules.

Entry points: [`CLAUDE.md`](../CLAUDE.md) (architecture, landmines, commands) · `docs/` (runbooks, decisions) · `scripts/deploy.sh` (the only way to deploy).

## 1. Quality gates (machine-decided, MUST)

Run `pnpm check` before pushing; the same gates run in CI and in `scripts/deploy.sh`:

| Gate | Command | Rule |
|---|---|---|
| Lint | `pnpm lint` | 0 errors. `no-explicit-any`, `no-console` (warn/error/info allowed), unused imports are errors. Warnings are a ratchet (`pnpm lint:strict` = 0 warnings is the target). |
| Types | `pnpm typecheck` | `strict`; no `@ts-ignore` (use `@ts-expect-error` with a reason). |
| i18n | `pnpm i18n:check` | Every key exists in all 13 locales, and every static `t('key')` resolves. next-intl throws on a missing key → a hole in one locale is a crash for that language. |
| Format | `pnpm format:check` | Prettier, config in `.prettierrc`. Applied on staged files by the pre-commit hook. |
| Dependencies | `pnpm audit:prod` | No critical advisory in runtime deps. High/moderate transitive build-tooling advisories are tolerated and listed in ADOPTION.md. |
| Schema | `pnpm drizzle-kit check` | Migrations folder in sync with `schema.ts`; migrations are additive and generated, never hand-written. |
| Build | `scripts/deploy.sh` | A deploy restarts PM2 only if `.next/BUILD_ID` exists after `pnpm build`. |

Git hooks (husky): pre-commit = prettier + eslint on staged files + typecheck; pre-push = i18n check + audit.

## 2. Code (MUST unless noted)

- **Money is idempotent and locked.** Every credit movement goes through `applyCreditTransaction` (row lock + idempotency key). Never write `users.creditsBalance*` elsewhere.
- **Jobs have terminal states.** `completed` / `failed` never change again; late webhooks are dropped; every failure after a hold refunds through `persistKieJobFailure`.
- **Never store a provider temp URL.** Results are copied to R2 or the job fails.
- **Models, prices, quotas live in `pricing.json`** — never hardcoded, never in `messages/*.json` (use placeholders fed by `modelNamesForCopy()`).
- **One public contact address**: `getAppContactEmail()`. No email literal in code.
- **Validate at the boundary**: server actions and routes parse input with zod; every endpoint checks ownership (`user_id`), not just authentication.
- **Server components by default**; `'use client'` only on leaves that need hooks/events. A server-only helper (`getTranslations`, DB) must never be imported from a client component.
- **File size (SHOULD, ratchet):** components ≲ 300 lines, modules ≲ 300 lines. `max-lines` warns at 600 today; the five known oversized files are listed in ADOPTION.md with a split plan. New files must not exceed 300.
- **No dead code, no commented-out code, no `TODO` without a ticket or a date.**

## 3. Documentation — only the irrecoverable (MUST)

The code carries the *what* and the *how*, checked by the compiler. Write only what dies with the author. One of these triggers a comment or a doc:

1. A **magic constant with an origin** (a threshold, a TTL, a plan limit).
2. A **coupling the compiler can't see** (a value that must match another file; a payload a consumer reads).
3. An **alternative that was rejected**, even after an hour.
4. **Defensive code** (retry, fallback, guard) — say *which real bug* it exists for.
5. A **deviation from a convention**, even justified.
6. A **POC** the code can't distinguish from a decision — mark it with a decision criterion.

Rule of thumb: reconstructible in ~15 minutes of reading → don't write it. Docs that paraphrase code are an untested second copy. Rejected in review: the *replay* (steps of the code), the *transcript* (chatty tone, "we'll see"), the *undated future* ("later", "post-MVP").

Every doc under `docs/` carries front-matter `status: acted|study|stale`, `implemented: yes|no|partial`, `last-verified: YYYY-MM-DD`. A change of behaviour touches the doc surgically. `CLAUDE.md` "Landmines" is where an incident becomes a rule.

## 4. Commits and changes (SHOULD)

- Conventional Commits in English (`feat|fix|chore|docs|refactor(scope): …`), body explains the *why* and the rejected alternative when there is one.
- One subject per commit. Migrations ship with the code that needs them and stay backward compatible with the running process.
- Non-trivial changes go through a PR (CI runs there); the PR body states **Decisions**: choice / alternative rejected / invariant introduced / origin. Empty is a valid, explicit answer.

## Backups (ops)

- **What:** `scripts/backup/backup-mysql.sh` — `mysqldump --single-transaction`
  → zstd → gpg AES-256 → `~/backups/oneshoplab-mysql/` (30 days) → R2
  `backups/mysql/` (**7 dailies + 4 weeklies**, R2 free quota is small — check
  with `pnpm backup:usage`). Cron: daily 03:30. Failures alert Discord
  `#staff-logs` via the bot API.
- **Drill:** `scripts/backup/restore-test.sh` restores the latest R2 backup
  into `oneshoplab_restore_test`, checks all tables are present and compares
  row counts, then drops it. Cron: Sundays 04:30. Logs in
  `~/backups/oneshoplab-mysql/*.log`.
- **Key:** `/home/ubuntu/.oneshoplab-backup.key` (0600, never in git). Without
  it backups are unreadable — keep a copy in the password manager.
- **Restore for real:** `gpg --decrypt --passphrase-file ~/.oneshoplab-backup.key FILE | zstd -d | sudo mysql oneshoplab`
  (stop the worker first; `pnpm db:migrate` afterwards if the schema moved).
- **CDN:** nginx returns 404 for `cdn.oneshoplab.com/backups/*` — the CDN
  fronts the whole bucket, so this block must stay.

## Tests

- Runner: vitest (`pnpm test`, `test:unit`, `test:db`, `test:watch`). Config in
  `vitest.config.mts`; `tests/setup-env.ts` forces placeholder secrets and a
  `<db>_test` DATABASE_URL (derived from `.env`, or `TEST_DATABASE_URL`);
  `tests/global-setup.ts` applies `drizzle/` migrations to it. The runner
  refuses any database whose name does not end in `_test`.
- Suites: `tests/unit` (no I/O: pricing snapshot + catalog invariants,
  provider routing with stubbed fetch/kie) and `tests/db` (real MySQL: credit
  ledger under concurrency, Stripe webhook replay). Each DB test truncates
  the tables it uses; seed helpers write ledger rows so `balance == SUM(ledger)`
  holds from the first assertion.
- Rule: any change on the money path (`src/lib/credits.ts`, webhook, pricing)
  ships with a test; a credit-cost change must update
  `tests/unit/__snapshots__/pricing.test.ts.snap` in the same commit.
- Gates: pre-push and CI run the full suite (CI uses a `mysql:8.0` service).

## Job status transitions

`jobs.status` is written in ONE place: `transitionJob()` in
`src/lib/jobs/transitions.ts` — a guarded `UPDATE … WHERE status IN (allowed
sources)`. Never `db.update(jobs).set({ status })` directly. Options:
`{ tolerate: true }` for best-effort callers (watchdogs, late kie callbacks —
log the `'refused'` result), `{ force }` for a user-driven retry of a
completed job. Inserts may still set an initial `pending`/`running`/`completed`
status. Allowed moves are unit-tested (`tests/unit/job-transitions.test.ts`)
and the guard is DB-tested (`tests/db/job-transitions.test.ts`).

## Import boundaries

Enforced by ESLint `no-restricted-imports` (see `eslint.config.mjs`):
app → components → lib; worker → lib. `src/components` never imports
`@/lib/db`, `@/worker`, `@/app`; `src/lib` never imports `@/components`,
`@/app`, `@/worker`; the worker never imports UI. `pnpm deps:circular` (madge)
fails on any import cycle — it is part of `pnpm check` and CI.

## Monitoring (ops)

- `GET /api/health` → 200 `{ ok, checks: { db, worker }, build }` or 503. The
  worker writes `data/worker.heartbeat` every tick (`writeWorkerHeartbeat`);
  older than 90 s = worker down.
- `scripts/ops/healthcheck.sh` runs every 5 min from cron: `/api/health`,
  `/fr`, pm2 web + worker, disk. One Discord `#staff-logs` alert per failing
  check (deduped in `~/.oneshoplab-healthcheck-alerts`), one "rétabli" when
  it clears. An external monitor (UptimeRobot/Better Stack, free) pointed at
  `https://oneshoplab.com/api/health` covers the case where the box itself
  is down — set it up from outside; nothing on the box can alert about the box.
- CSP is **Report-Only** (`next.config.ts`, `CSP_REPORT_ONLY`), violations
  logged as `[csp-report]` by the web process:
  `pm2 logs oneshoplab-web --nostream --lines 2000 | grep csp-report`. Enforce
  (rename the header) only after a quiet week; a nonce pipeline for Next's
  inline scripts would be the next hardening step.
