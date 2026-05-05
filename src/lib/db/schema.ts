import { relations } from 'drizzle-orm';
import {
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
export const JOB_KINDS = [
  'audit_run',
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

export type Platform = (typeof PLATFORMS)[number];
export type Plan = (typeof PLANS)[number];
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export type ChatModelDbId = (typeof CHAT_MODEL_IDS)[number];
export type ImageQualityDbId = (typeof IMAGE_QUALITY_IDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type JobKind = (typeof JOB_KINDS)[number];

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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    idxProjectId: index('idx_products_project_id').on(t.projectId),
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
    finishedAt: timestamp('finished_at')
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
