/**
 * One-shot migration: rewrite stored R2 public URLs from the legacy
 * pub-xxx.r2.dev origin to the new cdn.oneshoplab.com base.
 *
 * Touches every place a public R2 URL is persisted:
 *   - jobs.result.persistedUrls / resultUrls   (kie image jobs)
 *   - products.images[].src                    (manual + applied AI)
 *
 * Idempotent: a row already on the new base is skipped (the string
 * replace is a no-op). Safe to re-run.
 *
 * RUN ORDER MATTERS — only run this AFTER:
 *   1. cdn.oneshoplab.com nginx vhost is live and serving objects
 *   2. R2_PUBLIC_URL has been switched + the app restarted
 *      (so new uploads already use the cdn base)
 * Running it before the vhost is live would point every stored URL
 * at a domain that 404s.
 *
 * Usage:
 *   OLD_BASE=https://pub-950d1ead59e24488b51979d2c249e71a.r2.dev \
 *   NEW_BASE=https://cdn.oneshoplab.com \
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/migrate-r2-urls.ts [--dry]
 */
import { db } from '@/lib/db';
import { audits, jobs, products } from '@/lib/db/schema';
import { eq, like, or, sql } from 'drizzle-orm';

const OLD_BASE = (process.env.OLD_BASE ?? '').replace(/\/$/, '');
const NEW_BASE = (process.env.NEW_BASE ?? '').replace(/\/$/, '');
const DRY = process.argv.includes('--dry');

function rewrite(value: string): string {
  if (!value.startsWith(OLD_BASE + '/')) return value;
  return NEW_BASE + value.slice(OLD_BASE.length);
}

async function main() {
  if (!OLD_BASE || !NEW_BASE) {
    console.error('Set OLD_BASE and NEW_BASE env vars.');
    process.exit(1);
  }
  console.log(`Rewriting "${OLD_BASE}/" -> "${NEW_BASE}/" ${DRY ? '(DRY RUN)' : ''}`);

  // --- jobs.result ---------------------------------------------------
  // Image jobs store persistedUrls / resultUrls in the JSON result.
  const imageJobs = await db.query.jobs.findMany({
    where: or(eq(jobs.kind, 'kie_image_edit'), eq(jobs.kind, 'kie_image_generate'))
  });
  let jobsTouched = 0;
  for (const j of imageJobs) {
    const r = j.result as {
      persistedUrls?: string[];
      resultUrls?: string[];
      [k: string]: unknown;
    } | null;
    if (!r) continue;
    const persisted = (r.persistedUrls ?? []).map(rewrite);
    const result = (r.resultUrls ?? []).map(rewrite);
    const changed =
      JSON.stringify(persisted) !== JSON.stringify(r.persistedUrls ?? []) ||
      JSON.stringify(result) !== JSON.stringify(r.resultUrls ?? []);
    if (!changed) continue;
    jobsTouched += 1;
    if (!DRY) {
      await db
        .update(jobs)
        .set({ result: { ...r, persistedUrls: persisted, resultUrls: result } })
        .where(eq(jobs.id, j.id));
    }
  }
  console.log(`jobs: ${jobsTouched} rows ${DRY ? 'would be' : ''} updated`);

  // --- products.images ----------------------------------------------
  const rows = await db.query.products.findMany({
    where: like(products.images, `%${OLD_BASE}%`)
  });
  let productsTouched = 0;
  for (const p of rows) {
    const imgs = (p.images ?? []) as Array<{ src: string; [k: string]: unknown }>;
    let dirty = false;
    const next = imgs.map((img) => {
      const src = rewrite(img.src);
      if (src !== img.src) dirty = true;
      return { ...img, src };
    });
    if (!dirty) continue;
    productsTouched += 1;
    if (!DRY) {
      await db
        .update(products)
        .set({ images: next as typeof products.$inferInsert.images })
        .where(eq(products.id, p.id));
    }
  }
  console.log(`products: ${productsTouched} rows ${DRY ? 'would be' : ''} updated`);

  // --- audits.summary + jobs.input_payload --------------------------
  // These JSON blobs embed R2 URLs in shapes the field-aware passes
  // above don't reach: audits.summary.allProducts[].images[].src
  // (manual projects) and jobs.input_payload.sourceImageUrl (the
  // original image fed to kie for an edit). The bucket base only ever
  // appears as that exact origin, so a blanket serialized-string
  // replace is correct everywhere it occurs — and idempotent.
  const needle = OLD_BASE + '/';

  const auditRows = await db.execute(
    sql`SELECT id, summary FROM audits WHERE summary LIKE ${'%' + OLD_BASE + '%'}`
  );
  let auditsTouched = 0;
  for (const row of (auditRows as unknown as Array<Array<{ id: string; summary: unknown }>>)[0]) {
    const json = JSON.stringify(row.summary);
    if (!json.includes(needle)) continue;
    const next = json.split(needle).join(NEW_BASE + '/');
    auditsTouched += 1;
    if (!DRY) {
      await db
        .update(audits)
        .set({ summary: JSON.parse(next) })
        .where(eq(audits.id, row.id));
    }
  }
  console.log(`audits.summary: ${auditsTouched} rows ${DRY ? 'would be' : ''} updated`);

  const jobInputRows = await db.execute(
    sql`SELECT id, input_payload FROM jobs WHERE input_payload LIKE ${'%' + OLD_BASE + '%'}`
  );
  let jobInputTouched = 0;
  for (const row of (
    jobInputRows as unknown as Array<Array<{ id: string; input_payload: unknown }>>
  )[0]) {
    const json = JSON.stringify(row.input_payload);
    if (!json.includes(needle)) continue;
    const next = json.split(needle).join(NEW_BASE + '/');
    jobInputTouched += 1;
    if (!DRY) {
      await db
        .update(jobs)
        .set({ inputPayload: JSON.parse(next) })
        .where(eq(jobs.id, row.id));
    }
  }
  console.log(`jobs.input_payload: ${jobInputTouched} rows ${DRY ? 'would be' : ''} updated`);

  console.log('done');
}

main().then(() => process.exit(0));
