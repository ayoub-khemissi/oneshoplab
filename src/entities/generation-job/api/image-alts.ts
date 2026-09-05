import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/shared/db';
import { jobs, products, projects } from '@/shared/db/schema';
import { getEffectiveLanguage } from '@/entities/audit';
import { runAltTextOptim } from './alt-text';

/** Images described per pass — the model call is a second or two each. */
const MAX_PER_PASS = 5;

/**
 * Write the alt text of every image OneShopLab just generated.
 *
 * `costForImage` bills the picture and its alt as one purchase, so this is not
 * an extra: it is the second half of what the merchant already paid for. It
 * runs here rather than at generation time because a kie callback should not
 * wait on a second model call, and because a job is picked up by existing —
 * a retry, a watchdog replay or a future caller all land in the same place.
 *
 * The alt is stored on the job's own result, next to the image it describes.
 * It travels with the image when the change is applied, so a photo reaches the
 * store already described rather than needing a second trip.
 */
export async function generateAltsForNewImages(): Promise<number> {
  const candidates = await db
    .select({
      id: jobs.id,
      projectId: jobs.projectId,
      productId: jobs.productId,
      result: jobs.result
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.kind, ['kie_image_edit', 'kie_image_generate']),
        eq(jobs.status, 'completed'),
        isNotNull(jobs.productId)
      )
    )
    .orderBy(jobs.createdAt)
    .limit(MAX_PER_PASS * 40);

  let described = 0;
  for (const job of candidates) {
    if (described >= MAX_PER_PASS) break;
    const result = (job.result ?? {}) as { persistedUrls?: string[]; alts?: string[] };
    const urls = result.persistedUrls ?? [];
    // Nothing to describe, or already described on an earlier pass.
    if (urls.length === 0 || (result.alts?.length ?? 0) >= urls.length) continue;
    if (!job.projectId || !job.productId) continue;

    const product = await db.query.products.findFirst({
      where: eq(products.id, job.productId)
    });
    if (!product) continue;
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, job.projectId),
      columns: { userId: true }
    });
    if (!project) continue;
    const languageCode = await getEffectiveLanguage(job.projectId);

    const alts: string[] = [...(result.alts ?? [])];
    for (let i = alts.length; i < urls.length; i += 1) {
      try {
        const run = await runAltTextOptim({
          userId: project.userId,
          projectId: job.projectId,
          productSourceId: product.sourceId ?? product.handle ?? product.id,
          imageSrc: urls[i],
          // The context exists so the model names the object correctly, never
          // so it can restate the catalogue — hence no description, no price.
          product: {
            title: product.title,
            descriptionText: '',
            vendor: product.vendor,
            productType: product.productType,
            tags: (product.tags ?? []) as string[],
            imageCount: (product.images ?? []).length,
            priceMin: null,
            priceMax: null,
            currency: null
          },
          languageCode,
          // Already billed inside costForImage — never debit it twice.
          alreadyPaid: true
        });
        alts.push(run.alt);
      } catch (e) {
        // One sentence the model refused must not block the others, and must
        // not make the image un-appliable: the change simply carries no alt.
        console.error('[image-alts] failed', job.id, (e as Error).message);
        break;
      }
    }
    if (alts.length === 0) continue;

    await db
      .update(jobs)
      .set({ result: { ...result, alts } })
      .where(eq(jobs.id, job.id));
    described += 1;
  }
  if (described > 0) console.info(`[image-alts] described ${described} generated image(s)`);
  return described;
}
