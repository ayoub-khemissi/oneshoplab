import { relations } from 'drizzle-orm';
import {
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/mysql-core';

export const PLATFORMS = ['shopify', 'woocommerce', 'wix', 'manual', 'unknown'] as const;
export const PLANS = ['free', 'starter', 'pro', 'scale'] as const;
export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export const CHAT_MODEL_IDS = ['gemini-3-1-pro', 'sonnet-4-6', 'opus-4-6'] as const;
export const IMAGE_QUALITY_IDS = ['image-1k', 'image-2k', 'image-4k'] as const;
export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed', 'timed_out'] as const;
export const AUDIT_STATUSES = ['pending', 'running', 'completed', 'failed', 'timed_out'] as const;
export const PRODUCT_STATUSES = ['active', 'archived'] as const;
export const JOB_KINDS = [
  'audit_run',
  'bulk_site_generate',
  'kie_alt_text',
  'kie_description',
  'kie_tags',
  'kie_title',
  'kie_image_edit',
  'kie_image_generate',
  'kie_prompt_suggest',
  'kie_dynamic_audit'
] as const;

export const PRODUCT_FIELDS = ['title', 'description', 'images', 'tags'] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];

/**
 * Notification kinds — surfaced by the header bell. Each maps to a
 * server-side event in the generation pipeline. Chat events fire
 * synchronously from a route handler; image / audit / bulk events
 * fire from the worker after a callback or batched run.
 */
export const NOTIFICATION_KINDS = [
  'chat_completed',
  'chat_failed',
  'image_completed',
  'image_failed',
  'audit_completed',
  'audit_failed',
  'bulk_completed',
  'bulk_failed'
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Platform = (typeof PLATFORMS)[number];
export type Plan = (typeof PLANS)[number];
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export type ChatModelDbId = (typeof CHAT_MODEL_IDS)[number];
export type ImageQualityDbId = (typeof IMAGE_QUALITY_IDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// ============================================================================
// AUTH.JS TABLES (compatible with @auth/drizzle-adapter for MySQL)
// ============================================================================

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: varchar('image', { length: 1024 }),
  passwordHash: varchar('password_hash', { length: 255 }),

  // App-specific extensions
  plan: mysqlEnum('plan', PLANS).notNull().default('free'),
  /**
   * Total spendable credits = credits_balance_subscription + credits_balance_pack.
   * Maintained by applyCreditTransaction so existing reads (header chip,
   * session token, dashboards) keep working unchanged. Don't update directly.
   */
  creditsBalance: int('credits_balance').notNull().default(0),
  /** Reset to plan.credits at every successful subscription renewal. */
  creditsBalanceSubscription: int('credits_balance_subscription').notNull().default(0),
  /** Accumulated pack purchases — never expires. */
  creditsBalancePack: int('credits_balance_pack').notNull().default(0),
  preferredChatModel: mysqlEnum('preferred_chat_model', CHAT_MODEL_IDS)
    .notNull()
    .default('sonnet-4-6'),
  preferredImageQuality: mysqlEnum('preferred_image_quality', IMAGE_QUALITY_IDS)
    .notNull()
    .default('image-1k'),
  /** Account-wide DEFAULT bulk-generation prefs. A site with its own
   *  projects.bulkPrefs overrides this; if both are NULL the legacy
   *  "everything on, 3 angles" default applies. Same shape as
   *  projects.bulkPrefs. */
  defaultBulkPrefs: json('default_bulk_prefs').$type<{
    fields: {
      title: boolean;
      description: boolean;
      tags: boolean;
      images: boolean;
    };
    imageAngles: Array<'lifestyle' | 'studio' | 'inuse'>;
  } | null>(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
});

export const accounts = mysqlTable(
  'accounts',
  {
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: int('expires_at'),
    token_type: varchar('token_type', { length: 64 }),
    scope: varchar('scope', { length: 255 }),
    id_token: text('id_token'),
    session_state: varchar('session_state', { length: 255 })
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] })
  })
);

export const sessions = mysqlTable('sessions', {
  sessionToken: varchar('session_token', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull()
});

export const verificationTokens = mysqlTable(
  'verification_tokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] })
  })
);

// ============================================================================
// DOMAIN TABLES
// ============================================================================

export const projects = mysqlTable(
  'projects',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    source: mysqlEnum('source', PLATFORMS).notNull().default('unknown'),
    url: varchar('url', { length: 1024 }),
    domain: varchar('domain', { length: 255 }),
    /** Last time the owner consulted this project — used to pick the default
     *  project on dashboard load when the user has multiple stores. */
    lastViewedAt: timestamp('last_viewed_at'),
    /** Site-wide AI instructions appended to every generation in the project
     *  (brand voice, recurring constraints, etc.). NULL = no site-wide
     *  guidance. Combined at runtime with the per-product instructions. */
    customInstructions: text('custom_instructions'),
    /** Two-letter ISO 639-1 code overriding the audit-detected language for
     *  every AI generation on this project. NULL = use detectedLanguage from
     *  the latest audit summary, ultimately falling back to 'en'. Survives
     *  re-audits (audit refresh never overwrites this column). */
    languageOverride: varchar('language_override', { length: 8 }),
    /** Per-site bulk-generation preferences. NULL = legacy default
     *  (every field on, all 3 image angles) so existing sites are
     *  unchanged. Snapshotted into the bulk job payload at launch so a
     *  running job is unaffected by later edits. */
    bulkPrefs: json('bulk_prefs').$type<{
      fields: {
        title: boolean;
        description: boolean;
        tags: boolean;
        images: boolean;
      };
      imageAngles: Array<'lifestyle' | 'studio' | 'inuse'>;
    } | null>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    idxUserId: index('idx_projects_user_id').on(t.userId),
    idxDomain: index('idx_projects_domain').on(t.domain)
  })
);

/**
 * Audits are publicly readable analyses tied either to a user (via projectId)
 * or to a still-anonymous visitor (via anonToken cookie). On signup we migrate
 * the most recent anon audit into a project owned by the new user.
 */
export const audits = mysqlTable(
  'audits',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    domain: varchar('domain', { length: 255 }).notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    anonToken: varchar('anon_token', { length: 64 }),
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, {
      onDelete: 'set null'
    }),
    platform: mysqlEnum('platform', PLATFORMS).notNull().default('unknown'),
    status: mysqlEnum('status', AUDIT_STATUSES).notNull().default('pending'),
    scores: json('scores'),
    summary: json('summary'),
    productsSampled: int('products_sampled'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at')
  },
  (t) => ({
    idxDomain: index('idx_audits_domain').on(t.domain),
    idxAnonToken: index('idx_audits_anon_token').on(t.anonToken),
    idxProjectId: index('idx_audits_project_id').on(t.projectId),
    idxStatus: index('idx_audits_status').on(t.status)
  })
);

export const products = mysqlTable(
  'products',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: mysqlEnum('source', PLATFORMS).notNull(),
    sourceId: varchar('source_id', { length: 255 }),
    sourceUrl: varchar('source_url', { length: 1024 }),
    handle: varchar('handle', { length: 255 }),
    title: varchar('title', { length: 512 }).notNull(),
    descriptionHtml: text('description_html'),
    images: json('images').$type<
      Array<{ src: string; alt: string | null; width: number | null; height: number | null }>
    >(),
    tags: json('tags').$type<string[]>(),
    variants: json('variants').$type<
      Array<{
        id: string;
        title: string | null;
        price: number;
        sku: string | null;
        available: boolean;
        options: Record<string, string>;
      }>
    >(),
    vendor: varchar('vendor', { length: 255 }),
    productType: varchar('product_type', { length: 255 }),
    priceMin: decimal('price_min', { precision: 12, scale: 2 }),
    priceMax: decimal('price_max', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 8 }),
    sku: varchar('sku', { length: 128 }),
    sourceUpdatedAt: timestamp('source_updated_at'),
    /** Per-product AI instructions appended to every generation on this
     *  product page. Auto-saved on each generation request so the user's
     *  last guidance pre-fills the textarea on next visit. */
    customInstructions: text('custom_instructions'),
    /** Soft-archive flag. 'archived' = product was present on a previous
     *  scrape but is now missing from the store (deactivated, deleted,
     *  out-of-stock-and-hidden). The row + customInstructions + jobs all
     *  remain so a re-activation on the merchant store + re-audit
     *  restores them. UI surfaces a banner and disables generation. */
    status: mysqlEnum('status', PRODUCT_STATUSES).notNull().default('active'),
    /** Last scrape that confirmed presence. Used to detect stale rows. */
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    /** Set when status flips to 'archived'; cleared when the product
     *  re-appears in a scrape. */
    archivedAt: timestamp('archived_at'),
    /** True when a merchant explicitly archived this product from the
     *  dashboard (vs. auto-archived because it fell out of a scrape).
     *  syncProjectProducts must NOT un-archive a manually-archived row
     *  even if it reappears upstream — the merchant's choice is sticky
     *  until they restore it. */
    manuallyArchived: boolean('manually_archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    idxProjectId: index('idx_products_project_id').on(t.projectId),
    idxStatus: index('idx_products_status').on(t.status),
    uniqProjectSource: uniqueIndex('uniq_products_project_source').on(t.projectId, t.sourceId)
  })
);

/**
 * Background jobs: audit runs and AI optimizations through kie.ai.
 * Persisted before any external call so we can retry on crash and
 * remain idempotent against duplicate webhook deliveries.
 */
export const jobs = mysqlTable(
  'jobs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, {
      onDelete: 'cascade'
    }),
    auditId: varchar('audit_id', { length: 36 }).references(() => audits.id, {
      onDelete: 'set null'
    }),
    productId: varchar('product_id', { length: 36 }).references(() => products.id, {
      onDelete: 'cascade'
    }),
    kind: mysqlEnum('kind', JOB_KINDS).notNull(),
    status: mysqlEnum('status', JOB_STATUSES).notNull().default('pending'),
    kieTaskId: varchar('kie_task_id', { length: 128 }),
    inputPayload: json('input_payload'),
    result: json('result'),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    creditsCost: int('credits_cost').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    /** Soft-hide flag for image jobs the merchant has dismissed from the
     *  grid. Set on user-driven delete and on regenerate (the slot's old
     *  job is hidden when the new one starts). The row stays for audit /
     *  history purposes. */
    hiddenAt: timestamp('hidden_at'),
    /** Set by the r2-cleanup worker when an image job crosses its plan's
     *  retention window. The R2 objects are deleted and the result's
     *  URLs are cleared, but the row itself stays so the merchant's
     *  past-generations history keeps a tombstone showing when each
     *  image expired. Worker filters on `isNull(expiredAt)` so already-
     *  processed rows aren't re-walked every hour. */
    expiredAt: timestamp('expired_at')
  },
  (t) => ({
    idxStatus: index('idx_jobs_status').on(t.status),
    uniqKieTaskId: uniqueIndex('uniq_jobs_kie_task_id').on(t.kieTaskId),
    idxProjectId: index('idx_jobs_project_id').on(t.projectId)
  })
);

export const creditTransactions = mysqlTable(
  'credit_transactions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Positive = grant (signup, purchase, refund). Negative = consume (job). */
    delta: int('delta').notNull(),
    reason: varchar('reason', { length: 64 }).notNull(),
    jobId: varchar('job_id', { length: 36 }).references(() => jobs.id, { onDelete: 'set null' }),
    stripePaymentId: varchar('stripe_payment_id', { length: 128 }),
    /** Idempotency guard so retried webhooks/jobs don't double-charge. */
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    metadata: json('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (t) => ({
    idxUserId: index('idx_credit_tx_user_id').on(t.userId),
    uniqIdempotency: uniqueIndex('uniq_credit_tx_idempotency').on(t.idempotencyKey)
  })
);

/**
 * Per-user notification log surfaced by the header bell. Every
 * server-side generation outcome (chat / image / audit / bulk) ends
 * up here so the merchant has a persistent history they can scroll.
 *
 * `isRead` is set to true at insert time IFF the originating event
 * also produced a foreground toast the user was guaranteed to see
 * (e.g. a successful chat returning to a focused product page). The
 * background pipeline (image worker, audit completion) inserts with
 * isRead=false so the badge counts them up until the merchant opens
 * the bell. Clicking the bell flips every unread row for the user.
 *
 * `payload` carries kind-specific extras the dropdown renders without
 * a join (field name on a chat notif, error code on a failure, …).
 * Keeping it loose JSON beats a forest of nullable columns and the
 * bell only ever cares about the few keys per kind it knows about.
 */
export const notifications = mysqlTable(
  'notifications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', NOTIFICATION_KINDS).notNull(),
    /** Originating job (chat / image / dynamic-audit). Null for events
     *  that don't go through the jobs queue (audit completion). */
    jobId: varchar('job_id', { length: 36 }).references(() => jobs.id, {
      onDelete: 'set null'
    }),
    /** Originating audit (audit_completed / audit_failed). */
    auditId: varchar('audit_id', { length: 36 }).references(() => audits.id, {
      onDelete: 'set null'
    }),
    /** Navigation hint — dropdown row links to the product page. */
    productId: varchar('product_id', { length: 36 }).references(() => products.id, {
      onDelete: 'set null'
    }),
    /** Navigation hint — dropdown row links to the site page. */
    projectId: varchar('project_id', { length: 36 }).references(() => projects.id, {
      onDelete: 'set null'
    }),
    /** Kind-specific extras. Shape:
     *   chat_completed / chat_failed → { field: 'title'|'description'|'tags', errorMessage?: string }
     *   image_completed / image_failed → { errorMessage?: string }
     *   audit_completed → { score?: number, domain?: string }
     *   audit_failed → { errorMessage?: string, domain?: string }
     *   bulk_completed → { generated: number, total: number }
     *   bulk_failed → { errorMessage?: string }
     */
    payload: json('payload'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (t) => ({
    // Hottest read path: list recent notifs for the bell dropdown,
    // count unread for the badge. Composite (userId, isRead, createdAt)
    // covers both lookups without a sort filesort.
    idxUserUnreadCreated: index('idx_notif_user_unread_created').on(
      t.userId,
      t.isRead,
      t.createdAt
    ),
    /** Mark-as-read by jobId: client calls this after firing a toast,
     *  so the notification doesn't double up. */
    idxJobId: index('idx_notif_job_id').on(t.jobId),
    idxAuditId: index('idx_notif_audit_id').on(t.auditId)
  })
);

/**
 * Public, shareable case-study links generated by an admin user (the
 * sales / prospection flow). Each row issues one tokenised URL that
 * exposes a read-only static-audit + 2-product before/after view of
 * one of the admin's owned sites — no login required. Revoke flips
 * `revokedAt` so the public lookup 404s.
 *
 * The PK doubles as the URL slug to avoid a separate `token` column;
 * UUIDv4 is unguessable enough for prospect-link use.
 */
export const shareLinks = mysqlTable(
  'share_links',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Two productSourceIds (matches inputPayload.productSourceId on
     *  generated jobs). Stored as a JSON array so the admin's chosen
     *  order is preserved on the public page. */
    productSourceIds: json('product_source_ids').notNull(),
    /** Optional admin-facing label so the dashboard list is readable
     *  when the same site has several historical share links. */
    label: varchar('label', { length: 120 }),
    /** When true, the home page's showcase strip surfaces this case
     *  study (provided the link isn't revoked). Replaces the legacy
     *  SHOWCASE_PROJECT_IDS env list with admin-controlled curation. */
    showOnHome: boolean('show_on_home').notNull().default(false),
    /** Admin-curated sort weight for the home showcase. Lower comes
     *  first, NULL trails. Used as the primary tiebreaker inside each
     *  language tier so the admin can pin "always top-3" cards
     *  regardless of recency. NULL = unranked (default). */
    homeOrder: int('home_order'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    revokedAt: timestamp('revoked_at')
  },
  (t) => ({
    idxUserId: index('idx_share_links_user_id').on(t.userId),
    idxProjectId: index('idx_share_links_project_id').on(t.projectId)
  })
);

/**
 * One-time tokens for the password reset flow. We email the plaintext
 * token to the user and store only its sha256 in the DB so a leaked
 * dump can't be replayed. Each row carries an expiry (1h) and a
 * `used_at` column so a token can't be reused after the reset
 * succeeds. The unique index on `token_hash` is what makes the lookup
 * cheap on the reset page.
 */
export const passwordResetTokens = mysqlTable(
  'password_reset_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (t) => ({
    idxUserId: index('idx_password_reset_user_id').on(t.userId),
    uniqHash: uniqueIndex('uniq_password_reset_token_hash').on(t.tokenHash)
  })
);

// ============================================================================
// LEADS — sales prospection. Independent of users/projects: a lead is a
// candidate merchant we *discovered* (search query, manual paste), then
// qualified (platform detected + at least one product fetched). Status
// tracks the manual outreach funnel; an attempt row is appended each
// time the operator contacts them.
// ============================================================================

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'replied',
  'won',
  'lost',
  'dead'
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_ATTEMPT_CHANNELS = [
  'email',
  'instagram',
  'facebook',
  'x',
  'linkedin',
  'manual'
] as const;
export type LeadAttemptChannel = (typeof LEAD_ATTEMPT_CHANNELS)[number];

export const leads = mysqlTable(
  'leads',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    /** Canonical host (e.g. "example.myshopify.com" or "shop.example.com").
     *  Unique so two discovery passes never insert the same merchant twice. */
    domain: varchar('domain', { length: 255 }).notNull(),
    /** Full URL we qualified against (carries scheme + path). */
    url: varchar('url', { length: 1024 }).notNull(),
    platform: mysqlEnum('platform', PLATFORMS).notNull().default('unknown'),
    /** Number of products the adapter fetched during qualification. */
    productsSampled: int('products_sampled').notNull().default(0),
    /** ISO 639-1 detected from the storefront's html lang attr / Accept-Language. */
    language: varchar('language', { length: 8 }),
    /** ISO 3166-1 alpha-2 inferred when the storefront exposes it (Shopify
     *  shop.countryCode, WC store locale, …). Otherwise NULL. */
    country: varchar('country', { length: 4 }),
    /** Quick overall score 0..100 from a one-shot static audit run.
     *  Drives the operator's "high-potential first" sort in the admin
     *  list. NULL when the audit hasn't been scored yet. */
    score: int('score'),
    /** Best-guess primary email. Pulled from mailto: links, contact pages,
     *  and the page footer. NULL when nothing parseable was found. */
    contactEmail: varchar('contact_email', { length: 255 }),
    /** Free-form list of social URLs (Instagram, Facebook, X, …). Limited
     *  to 8 to bound the column. */
    contactSocials: json('contact_socials'),
    status: mysqlEnum('status', LEAD_STATUSES).notNull().default('new'),
    /** Operator notes — visible only in the admin UI. Plain text. */
    notes: text('notes'),
    /** Provenance: the query string or seed-file path that surfaced this
     *  lead. Useful for measuring which queries produce winners. */
    discoveredVia: text('discovered_via'),
    discoveredAt: timestamp('discovered_at').notNull().defaultNow(),
    /** Set the first time qualification succeeded. */
    qualifiedAt: timestamp('qualified_at'),
    /** Most recent outreach attempt (mirrors the latest lead_attempts row). */
    lastAttemptedAt: timestamp('last_attempted_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    uniqDomain: uniqueIndex('uniq_leads_domain').on(t.domain),
    idxStatus: index('idx_leads_status').on(t.status),
    idxPlatform: index('idx_leads_platform').on(t.platform),
    idxLanguage: index('idx_leads_language').on(t.language),
    idxDiscoveredAt: index('idx_leads_discovered_at').on(t.discoveredAt)
  })
);

export const leadAttempts = mysqlTable(
  'lead_attempts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    leadId: varchar('lead_id', { length: 36 })
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    channel: mysqlEnum('channel', LEAD_ATTEMPT_CHANNELS).notNull(),
    /** What we sent (email body, DM, etc.). */
    payload: text('payload'),
    /** What came back, if anything. NULL = no reply yet. */
    response: text('response'),
    attemptedAt: timestamp('attempted_at').notNull().defaultNow()
  },
  (t) => ({
    idxLeadId: index('idx_lead_attempts_lead_id').on(t.leadId),
    idxAttemptedAt: index('idx_lead_attempts_attempted_at').on(t.attemptedAt)
  })
);

export const subscriptions = mysqlTable('subscriptions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 128 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 128 }),
  stripePriceId: varchar('stripe_price_id', { length: 128 }),
  plan: mysqlEnum('plan', PLANS).notNull().default('free'),
  billingCycle: mysqlEnum('billing_cycle', BILLING_CYCLES),
  status: varchar('status', { length: 64 }).notNull().default('active'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
});

// ============================================================================
// RELATIONS (for Drizzle's relational query API)
// ============================================================================

export const usersRelations = relations(users, ({ many, one }) => ({
  projects: many(projects),
  creditTransactions: many(creditTransactions),
  subscription: one(subscriptions, {
    fields: [users.id],
    references: [subscriptions.userId]
  })
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  audits: many(audits),
  products: many(products),
  jobs: many(jobs)
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  project: one(projects, { fields: [audits.projectId], references: [projects.id] }),
  jobs: many(jobs)
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  project: one(projects, { fields: [products.projectId], references: [projects.id] }),
  jobs: many(jobs)
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  project: one(projects, { fields: [jobs.projectId], references: [projects.id] }),
  audit: one(audits, { fields: [jobs.auditId], references: [audits.id] }),
  product: one(products, { fields: [jobs.productId], references: [products.id] }),
  creditTransactions: many(creditTransactions)
}));

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  user: one(users, { fields: [creditTransactions.userId], references: [users.id] }),
  job: one(jobs, { fields: [creditTransactions.jobId], references: [jobs.id] })
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] })
}));

export const leadsRelations = relations(leads, ({ many }) => ({
  attempts: many(leadAttempts)
}));

export const leadAttemptsRelations = relations(leadAttempts, ({ one }) => ({
  lead: one(leads, { fields: [leadAttempts.leadId], references: [leads.id] })
}));

/**
 * Public contact-form submissions (/contact). Stored first, THEN fanned
 * out to Discord + the inbox, so a notification outage never loses a
 * message — the two *NotifiedAt columns say which channels actually
 * fired. userId is filled when the sender was logged in (lets support
 * jump to the account). ip/userAgent feed the abuse rate-limit only.
 */
export const contactMessages = mysqlTable(
  'contact_messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).references(() => users.id, {
      onDelete: 'set null'
    }),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 200 }),
    message: text('message').notNull(),
    locale: varchar('locale', { length: 8 }).notNull().default('en'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    discordNotifiedAt: timestamp('discord_notified_at'),
    emailNotifiedAt: timestamp('email_notified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (t) => ({
    idxCreatedAt: index('idx_contact_messages_created_at').on(t.createdAt),
    idxEmail: index('idx_contact_messages_email').on(t.email),
    idxIp: index('idx_contact_messages_ip').on(t.ip)
  })
);
