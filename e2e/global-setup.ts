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
    const { audit } = await import('@/entities/audit');
    const { product, images } = await import('../tests/unit/audit-fixtures');
    const schema = await import('@/shared/db/schema');

    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    for (const t of [
      'credit_transactions', 'legal_consents', 'subscriptions', 'password_reset_tokens',
      'contact_messages', 'notifications', 'share_links', 'jobs', 'audits', 'products',
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

    await db.insert(schema.shareLinks).values([
      { id: SEED.shareLinkId, userId, projectId: SEED.project.id, productSourceIds: ['p1', 'p2'], label: 'E2E', showOnHome: true },
      { id: SEED.revokedShareLinkId, userId, projectId: SEED.project.id, productSourceIds: ['p1', 'p2'], label: 'Revoked', revokedAt: new Date() }
    ]);
  } finally {
    await conn.end();
  }
}
