import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { E2E_ENV } from '../playwright.config';
import { SEED } from './seed';

export default async function globalSetup(): Promise<void> {
  Object.assign(process.env, E2E_ENV);
  const conn = await mysql.createConnection({ uri: E2E_ENV.DATABASE_URL, multipleStatements: true });
  const db = drizzle(conn);
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });

    // Modules that read env at import time come after the env is set.
    // File path on purpose: Playwright's TS loader cannot resolve an alias to a
    // directory index (the barrel reaches @/shared/db → index.ts).
    const { audit } = await import('@/entities/audit/lib/score');
    const { product, images } = await import('../tests/unit/audit-fixtures');
    const schema = await import('@/shared/db/schema');

    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    for (const t of [
      'credit_transactions', 'legal_consents', 'subscriptions', 'password_reset_tokens',
      'contact_messages', 'notifications', 'share_links', 'product_changes', 'api_key_events',
      'connection_capabilities',
      'api_keys', 'api_idempotency', 'catalog_sync_sessions', 'jobs', 'audits', 'products',
      'projects', 'users', 'sessions', 'accounts'
    ]) {
      await db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
    }
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);

    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      email: SEED.user.email,
      name: SEED.user.name,
      passwordHash: await bcrypt.hash(SEED.user.password, 4),
      plan: 'pro',
      creditsBalance: 500,
      creditsBalancePack: 500
    });
    await db.insert(schema.creditTransactions).values({
      id: randomUUID(), userId, delta: 500, reason: 'seed', metadata: { bucket: 'pack' }
    });

    await db.insert(schema.projects).values({
      id: SEED.project.id,
      userId,
      name: SEED.project.domain,
      domain: SEED.project.domain,
      url: `https://${SEED.project.domain}`,
      source: 'shopify'
    });

    const catalog = [
      product({ sourceId: 'p1', handle: 'stoneware-mug', title: 'Hand-thrown stoneware coffee mug, 350 ml' }),
      product({ sourceId: 'p2', handle: 'linen-apron', title: 'Washed linen kitchen apron, natural', images: images(2) }),
      product({ sourceId: 'p3', handle: 'oak-board', title: 'Oak board', tags: [], images: images(1, { alt: null }) })
    ];
    const report = audit(catalog);
    const auditId = randomUUID();
    await db.insert(schema.audits).values({
      id: auditId,
      projectId: SEED.project.id,
      domain: SEED.project.domain,
      url: `https://${SEED.project.domain}`,
      platform: 'shopify',
      status: 'completed',
      scores: report.scores,
      summary: { ...report, detectionSignals: ['seed'], detectionConfidence: 1 },
      productsSampled: catalog.length,
      completedAt: new Date()
    });
    await db.insert(schema.products).values(
      catalog.map((p) => ({
        id: randomUUID(),
        projectId: SEED.project.id,
        source: 'shopify' as const,
        sourceId: p.sourceId,
        sourceUrl: p.sourceUrl,
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        images: p.images,
        tags: p.tags,
        variants: p.variants,
        vendor: p.vendor,
        productType: p.productType,
        priceMin: p.priceMin == null ? null : String(p.priceMin),
        priceMax: p.priceMax == null ? null : String(p.priceMax),
        currency: p.currency,
        sku: p.sku,
        status: 'active' as const
      }))
    );

    // Anonymous audit (public /audit result page).
    await db.insert(schema.audits).values({
      id: randomUUID(),
      anonToken: SEED.anonAuditToken,
      domain: 'anon-shop.example.com',
      url: 'https://anon-shop.example.com',
      platform: 'shopify',
      status: 'completed',
      scores: report.scores,
      summary: { ...report, detectionSignals: ['seed'], detectionConfidence: 1 },
      productsSampled: catalog.length,
      completedAt: new Date()
    });

    // A second store whose connection declared the image ops: the product
    // image editor offers its per-photo actions only there (IMAGE-OPS.md §7).
    await db.insert(schema.projects).values({
      id: SEED.imageProject.id,
      userId,
      name: SEED.imageProject.domain,
      domain: SEED.imageProject.domain,
      url: `https://${SEED.imageProject.domain}`,
      source: 'woocommerce'
    });
    await db.insert(schema.products).values({
      id: SEED.imageProduct.id,
      projectId: SEED.imageProject.id,
      source: 'woocommerce',
      sourceId: SEED.imageProduct.sourceId,
      handle: 'photographed-mug',
      title: 'Photographed stoneware mug',
      descriptionHtml: '<p>Three photos, three ids.</p>',
      images: SEED.imageProduct.imageIds.map((sourceImageId, i) => ({
        src: `https://cdn.test/photo-${i + 1}.jpg`,
        alt: i === 0 ? 'Front view' : null,
        width: 800,
        height: 800,
        position: i,
        sourceImageId
      })),
      tags: ['mug'],
      status: 'active' as const
    });
    // The default store is a connected one too: it reports only the minimum
    // capabilities (no stable image ids), which is a real plugin state — but a
    // store with NO connection now hides every sync surface, and the spec
    // about the replace-all fallback needs the editor on screen.
    await db.insert(schema.apiKeys).values({
      id: '11111111-0000-4000-8000-000000000001',
      projectId: SEED.project.id,
      userId,
      name: 'E2E plugin (minimum)',
      prefix: 'osl_live_min',
      keyHash: 'm'.repeat(64),
      permissions: ['catalog:write', 'changes:read', 'changes:ack']
    });

    // A store that declared capabilities without anything actually connected
    // cannot exist in production — the capabilities ARRIVE with the plugin —
    // and the pages now hide every store-sync surface where there is no
    // connection. So the fixture carries the key that makes it a real one.
    await db.insert(schema.apiKeys).values({
      id: '55555555-0000-4000-8000-000000000001',
      projectId: SEED.imageProject.id,
      userId,
      name: 'E2E plugin',
      prefix: 'osl_live_e2e',
      keyHash: 'e'.repeat(64),
      permissions: ['catalog:write', 'changes:read', 'changes:ack']
    });
    await db.insert(schema.connectionCapabilities).values({
      projectId: SEED.imageProject.id,
      platform: 'woocommerce',
      capabilities: {
        stableImageIds: true,
        imageOps: ['set_featured', 'append', 'replace', 'remove', 'set_alt', 'reorder'],
        maxImages: 30,
        altEditable: true,
        fields: ['title', 'description', 'tags', 'images']
      }
    });

    // A third store whose changes are still waiting: the banner + recap modal
    // need one pending change per field and one the store refused. Waiting
    // changes imply a store that can receive them — without a connection they
    // would now be hidden, and the sweep would eventually fail them.
    const { hashValue } = await import('@/entities/product-change/lib/hash');
    await db.insert(schema.projects).values({
      id: SEED.pendingProject.id,
      userId,
      name: SEED.pendingProject.domain,
      domain: SEED.pendingProject.domain,
      url: `https://${SEED.pendingProject.domain}`,
      source: 'woocommerce'
    });

    await db.insert(schema.apiKeys).values({
      id: '77777777-0000-4000-8000-000000000001',
      projectId: SEED.pendingProject.id,
      userId,
      name: 'E2E plugin (pending)',
      prefix: 'osl_live_pen',
      keyHash: 'p'.repeat(64),
      permissions: ['catalog:write', 'changes:read', 'changes:ack']
    });
    await db.insert(schema.products).values({
      id: SEED.pendingProduct.id,
      projectId: SEED.pendingProject.id,
      source: 'woocommerce',
      sourceId: SEED.pendingProduct.sourceId,
      handle: 'waiting-mug',
      title: 'Waiting stoneware mug',
      descriptionHtml: '<p>An old description.</p>',
      images: [{ src: 'https://cdn.test/waiting.jpg', alt: null, width: 800, height: 800, position: 0 }],
      tags: ['mug'],
      status: 'active'
    });
    await db.insert(schema.jobs).values({
      id: SEED.pendingChanges.failedJobId,
      projectId: SEED.pendingProject.id,
      productId: SEED.pendingProduct.id,
      kind: 'kie_tags',
      status: 'completed',
      inputPayload: { productSourceId: SEED.pendingProduct.sourceId },
      result: { output: ['stoneware', 'handmade'] }
    });
    const change = (
      id: string,
      field: 'title' | 'description' | 'tags',
      value: unknown,
      prior: unknown,
      extra: Record<string, unknown> = {}
    ) => ({
      id,
      projectId: SEED.pendingProject.id,
      productId: SEED.pendingProduct.id,
      productSourceId: SEED.pendingProduct.sourceId,
      field,
      value,
      valueHash: hashValue(value),
      priorValueHash: hashValue(prior),
      priorValue: prior,
      approvedBy: userId,
      ...extra
    });
    await db.insert(schema.productChanges).values([
      change(SEED.pendingChanges.title, 'title', 'Hand-thrown stoneware mug', 'Waiting stoneware mug'),
      change(
        SEED.pendingChanges.description,
        'description',
        '<p>A new description.</p>',
        '<p>An old description.</p>'
      ),
      change(SEED.pendingChanges.failedTags, 'tags', ['stoneware', 'handmade'], ['mug'], {
        sourceJobId: SEED.pendingChanges.failedJobId,
        status: 'failed',
        ackedAt: new Date(),
        ackPayload: { status: 'failed', error: 'HTTP 500' }
      })
    ]);

    await db.insert(schema.shareLinks).values([
      { id: SEED.shareLinkId, userId, projectId: SEED.project.id, productSourceIds: ['p1', 'p2'], label: 'E2E', showOnHome: true },
      { id: SEED.revokedShareLinkId, userId, projectId: SEED.project.id, productSourceIds: ['p1', 'p2'], label: 'Revoked', revokedAt: new Date() }
    ]);
  } finally {
    await conn.end();
  }
}
