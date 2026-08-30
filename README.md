# OneShopLab

AI-powered product page optimization for Shopify, WooCommerce, and Wix stores.
Merchants connect a store, OneShopLab audits each product page (titles,
descriptions, images, tags), grades them, and generates rewrites/imagery on
demand. Billing is credit-based with monthly subscriptions on top.

Production: <https://oneshoplab.com>

## Stack

- **Next.js 16** (App Router, Turbopack) — server components, server actions,
  middleware-based locale routing via `next-intl`.
- **MySQL 8** + **Drizzle ORM** — schema in `src/lib/db/schema.ts`,
  migrations in `drizzle/`.
- **Auth.js v5 (next-auth beta)** with the Drizzle adapter — credentials +
  OAuth providers, session cookies signed with `AUTH_SECRET`.
- **Stripe** — subscriptions (Starter / Pro / Scale × monthly / yearly),
  webhook-driven plan + credit grants.
- **Cloudflare R2** — S3-compatible asset storage for generated images and
  user uploads.
- **kie.ai** — proxied LLM + image generation provider. We mark up its raw
  cost by `CREDIT_MARKUP_FACTOR` (default 2.5×) and bill in OneShopLab credits
  (1 credit = $0.005 retail).
- **PM2** in production: one Next.js web process + one tsx worker.

## Repository layout

```
src/
  app/                     Next.js routes
    [locale]/              i18n-prefixed pages (13 locales — en/fr/es/de/it/pt/ru/pl/tr/ar/zh/ja/ko)
      pricing/             marketing pricing page
      login/  signup/      auth flows
      dashboard/sites/     store list + per-site audit views
      account/preferences/ user settings
    api/
      auth/[...nextauth]/  Auth.js handler
      stripe/webhook/      Stripe events → DB plan/credit updates
      kie/callback/        kie.ai webhook (job completion)
      products/generate/   on-demand product rewrite endpoint
  components/              UI components (server + client)
  i18n/                    next-intl routing + request config
  lib/
    adapters/              store-platform readers (shopify, woocommerce, wix, manual)
    ai/                    kie.ai client, model registry, prompts, optims
    audit/                 scoring, run/process/refresh, commentary tiers
    auth.ts auth-actions.ts session + login/signup server actions
    credits.ts             credit ledger (debit/grant atomically)
    db/                    drizzle client + schema
    storage/r2.ts          S3 client for Cloudflare R2 (TLS 1.3 forced)
    stripe.ts stripe-actions.ts checkout + plan resolver
  worker/                  background job loop (audit-runner + kie-watchdog)
  proxy.ts                 next-intl middleware (locale routing)

drizzle/                   SQL migrations
deploy/                    nginx vhost sample
scripts/                   admin one-shots: claim-audit, reconcile-kie-jobs,
                           refresh-audit-summary, set-plan
tools/email-scraper/       standalone Puppeteer scraper for store contact emails
messages/                  i18n catalogs (one JSON per locale)
```

## Local development

Requirements: Node ≥ 20, pnpm 9, MySQL 8, a kie.ai API key, Cloudflare R2
credentials, a Stripe test account.

```bash
pnpm install
cp .env.example .env
# Fill in DATABASE_URL, AUTH_SECRET, KIE_API_KEY, R2_*, STRIPE_*

pnpm db:migrate
pnpm dev              # Next.js on http://localhost:3000
pnpm worker:dev       # background worker (separate terminal)
```

Generating an `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

To stripe-listen the webhook locally:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the printed `whsec_…` into STRIPE_WEBHOOK_SECRET
```

## Scripts

```bash
pnpm dev            # next dev with Turbopack
pnpm build          # next build (output: standalone is NOT used — see Deploy notes)
pnpm start          # next start
pnpm lint           # next lint
pnpm typecheck      # tsc --noEmit (covers .ts, .tsx, .mts)

pnpm db:generate    # drizzle-kit: create a new migration from schema diff
pnpm db:migrate     # apply migrations to DATABASE_URL
pnpm db:studio      # drizzle-kit web UI

pnpm worker:dev     # tsx watch src/worker/index.mts
pnpm worker:start   # tsx src/worker/index.mts

pnpm reconcile      # one-shot: walk pending kie jobs and reconcile their state
```

Admin scripts in `scripts/` (run via `tsx scripts/<file>.ts`):

- `set-plan.ts` — manually flip a user's plan (e.g. `tsx scripts/set-plan.ts user@example.com pro`)
- `claim-audit.ts` — assign an anonymous (pre-signup) audit to a user account
- `reconcile-kie-jobs.ts` — same as `pnpm reconcile`
- `refresh-audit-summary.ts` — recompute cached audit aggregates

## Worker

`src/worker/index.mts` runs a 5 s tick loop and on each tick fans out:

- `runAuditRunner` — picks up audit jobs queued by the web (a user clicking
  "Audit my store") and processes them: fetch the store via the right
  adapter, score products, persist the report.
- `runKieWatchdog` — polls in-flight kie.ai jobs that didn't deliver a
  webhook in time and marks them failed/refunded so credits don't get stuck.

The entry must be `.mts`: it uses top-level `await import(...)` to delay
loading audit-runner / kie-watchdog until after `loadEnv()` runs, and tsx
defaults to a CJS transform target which forbids top-level await. The `.mts`
extension forces the ESM transform.

## Production deployment (Ubuntu / OVH)

The current production stack runs on a single OVH dedicated server:
nginx terminates TLS via Let's Encrypt and proxies to a local Next.js
process managed by PM2.

### Initial setup

```bash
# 1. Install runtime deps
sudo apt install -y nginx certbot python3-certbot-nginx mysql-server
curl -fsSL https://nodejs.org/dist/v20.20.1/node-v20.20.1-linux-x64.tar.xz | \
  sudo tar -xJ -C /usr/local --strip-components=1
# Node 22 LTS lives in /opt/node22 (see ecosystem.config.cjs); pnpm/pm2 may run on the system node
npm i -g pnpm@9 pm2

# 2. Database
sudo mysql -e "CREATE DATABASE oneshoplab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
              CREATE USER 'oneshoplab'@'127.0.0.1' IDENTIFIED BY '<password>';
              GRANT ALL PRIVILEGES ON oneshoplab.* TO 'oneshoplab'@'127.0.0.1';"

# 3. App
git clone git@github.com:ayoub-khemissi/oneshoplab.git /home/ubuntu/oneshoplab
cd /home/ubuntu/oneshoplab/oneshoplab
pnpm install
cp .env.example .env
chmod 600 .env
# Fill .env (DATABASE_URL, AUTH_URL=https://oneshoplab.com, AUTH_SECRET,
# KIE_*, R2_*, STRIPE_*)
pnpm db:migrate
pnpm build

# 4. PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup     # follow the printed sudo command to enable systemd unit

# 5. nginx + TLS
sudo cp deploy/nginx.conf.sample /etc/nginx/conf.d/oneshoplab.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d oneshoplab.com -d www.oneshoplab.com \
  --non-interactive --agree-tos -m you@example.com --redirect
```

`certbot.timer` (installed by the Ubuntu package) renews automatically
twice per day. Verify with `sudo certbot renew --dry-run --cert-name oneshoplab.com`.

### Why we don't use `output: 'standalone'`

We tried it; Next.js's standalone server bakes the bind hostname/port (e.g.
`localhost:3030`) into absolute middleware-rewrite URLs. Behind a reverse
proxy that hands off `X-Forwarded-Proto: https`, Next then attempts to
TLS-handshake itself on the plain-HTTP upstream port and 500s with EPROTO.
PM2 is configured to run `next start` directly, which sidesteps the issue.

### nginx quirks worth knowing

The vhost in `deploy/nginx.conf.sample`:

- **Does not forward `X-Forwarded-Proto`** on the catch-all `/` location.
  Next.js otherwise builds internal middleware-rewrite URLs as
  `https://localhost:3030/...` and tries to fetch them over TLS. Auth.js
  still emits `Secure` cookies because we set `AUTH_URL=https://oneshoplab.com`.
- **Rewrites leaking Location headers** via several `proxy_redirect` rules:
  even with the right env, Next sometimes emits `http://oneshoplab.com:3030/`
  in 30x responses. The redirects strip `:3030` and force https.
- **Forwards `X-Forwarded-Proto` only on webhook locations** (`/api/stripe/webhook`,
  `/api/kie/callback`) where Stripe signature verification needs the original
  scheme.

### Locale routing

`src/i18n/routing.ts` uses `localePrefix: 'always'`. Every request goes to
`/<locale>/...`. We tried `'as-needed'` (default locale at `/` with no prefix)
but it loops behind a reverse proxy: `/` rewrites to `/en` internally, and
`/en` 307s back to `/` because it's the canonical default-locale URL.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `mysql://user:pwd@host:3306/db` |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_URL` | yes | Public origin, e.g. `https://oneshoplab.com` |
| `APP_URL` / `APP_ENV` | yes | Same origin as AUTH_URL; `production` / `development` |
| `KIE_API_KEY` | yes | Generation provider |
| `KIE_BASE_URL` | yes | `https://api.kie.ai` |
| `R2_ACCOUNT_ID` | yes | Cloudflare account UUID |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | yes | R2 API token (Object Read & Write) |
| `R2_BUCKET` | yes | e.g. `oneshoplab` |
| `R2_PUBLIC_URL` | yes | Either `https://<custom>.your-domain` or `https://pub-<id>.r2.dev` |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | yes | Test mode in dev, live in prod |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the Stripe webhook endpoint |
| `STRIPE_PRICE_<PLAN>_<CYCLE>` | yes (six total) | One Stripe Price ID per plan/cycle |
| `CREDIT_MARKUP_FACTOR` | no | Default 2.5×; clamped to [1, 10] |
| `SHOWCASE_PROJECT_IDS` | no | Comma-separated project IDs to feature on the landing page |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | no | GA4 id (`G-XXXX`). Unset = no analytics, cookie banner stays informational. Set = opt-in consent banner + consent-gated GA (anonymized IP, no ad signals) |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | no | reCAPTCHA v2 pair. Both set = captcha on signup + the public free-audit form; unset = skipped (dev-safe) |

## Plans & billing

Defined in `src/lib/ai/models.ts` (`PLAN_TIERS`):

| Plan | Monthly (EUR) | Credits / mo | Stores |
|---|---|---|---|
| Free | €0 (one-shot 150 credits) | 150 | 1 |
| Starter | €39.99 | 5,500 | 3 |
| Pro | €89.99 | 15,000 | 10 |
| Scale | €199.99 | 38,000 | 50 |

Yearly cycle = monthly × 12 × 0.8 (-20%). Credits are debited per generation
through `chatCreditsToDebit` / `costForImage` in `src/lib/ai/models.ts`.
Stripe webhook (`/api/stripe/webhook`) is the source of truth for plan
changes — it grants/resets the monthly credit balance and persists the
plan + cycle on the user row.

## Tools

`tools/email-scraper/` — standalone Puppeteer scraper that walks a list of
WooCommerce / Shopify / Wix domains and extracts the contact email. Has its
own `package.json` and is unrelated to the Next.js build. Run with
`node tools/email-scraper/index.js`.

## Tests

There is no automated test suite yet. The deployment is verified with `curl`
smoke-tests against the public origin (see commit history for examples) and
local manual QA against the Stripe test mode.
