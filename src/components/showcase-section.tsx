import { Card } from '@heroui/react';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { audits, jobs } from '@/lib/db/schema';

/**
 * Public showcase strip for the landing page. Renders before/after cards from
 * the projects whose IDs are listed in the `SHOWCASE_PROJECT_IDS` env var
 * (comma-separated). For each, we pull the latest completed audit, pick its
 * first AI-generated product, and render a side-by-side preview.
 *
 * Editing the env var (and redeploying) is the simplest way to swap the
 * showcased stores without a UI flow — sufficient for prospection.
 */
export async function ShowcaseSection() {
  const ids = (process.env.SHOWCASE_PROJECT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return null;

  const showcaseAudits = await Promise.all(ids.map((id) => loadShowcase(id)));
  // Dedupe by domain — even if two different users have audits on the same
  // store we don't want duplicate cards. First-found wins (preserves the
  // env var ordering).
  const seen = new Set<string>();
  const items: ShowcaseItem[] = [];
  for (const item of showcaseAudits) {
    if (!item) continue;
    const key = item.domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= 6) break;
  }
  if (items.length === 0) return null;

  const t = await getTranslations('Showcase');

  return (
    <section className="relative z-10 max-w-6xl w-full mx-auto px-6 py-16 md:py-20 flex flex-col gap-8">
      <header className="flex flex-col items-center text-center gap-2 max-w-2xl mx-auto">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)] font-mono">
          {t('eyebrow')}
        </span>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('title')}</h2>
        <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
          {t('subtitle')}
        </p>
      </header>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <ShowcaseCard
            key={item.auditId}
            item={item}
            sourceLabel={t('sourceLabel')}
            aiLabel={t('aiLabel')}
          />
        ))}
      </div>
    </section>
  );
}

interface ShowcaseItem {
  auditId: string;
  domain: string;
  platform: string;
  productSourceId: string | null;
  sourceTitle: string;
  aiTitle: string;
  sourceImage: string | null;
  aiImage: string | null;
}

async function loadShowcase(projectId: string): Promise<ShowcaseItem | null> {
  const audit = await db.query.audits.findFirst({
    where: and(eq(audits.projectId, projectId), eq(audits.status, 'completed')),
    orderBy: [desc(audits.createdAt)]
  });
  if (!audit?.summary) return null;

  const summary = audit.summary as {
    latestProducts?: Array<{
      sourceId: string | null;
      title: string;
      images: Array<{ src: string }>;
    }>;
  };
  const candidates = summary.latestProducts ?? [];
  if (candidates.length === 0) return null;

  // Pull the AI jobs for this audit, then iterate over candidate products to
  // find the FIRST one with a clean, complete generation (both AI image AND
  // a distinct AI title). Products with failed/missing gens are skipped.
  const candidateJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.auditId, audit.id),
      inArray(jobs.kind, ['kie_dynamic_audit', 'kie_image_edit'])
    )
  });

  for (const candidate of candidates) {
    const sourceId = candidate.sourceId;
    if (!sourceId) continue;

    const dynJob = candidateJobs.find(
      (j) =>
        j.kind === 'kie_dynamic_audit' &&
        (j.inputPayload as { productSourceId?: string | null } | null)?.productSourceId ===
          sourceId
    );
    const imgJob = candidateJobs.find(
      (j) =>
        j.kind === 'kie_image_edit' &&
        j.status === 'completed' &&
        (j.inputPayload as { productSourceId?: string | null } | null)?.productSourceId ===
          sourceId
    );

    const aiTitleRaw = (dynJob?.result as { newTitle?: string } | null)?.newTitle;
    const imgResult = imgJob?.result as
      | { persistedUrls?: string[]; resultUrls?: string[] }
      | null;
    const aiImage = imgResult?.persistedUrls?.[0] ?? imgResult?.resultUrls?.[0] ?? null;
    const sourceImage = candidate.images?.[0]?.src ?? null;

    // Skip products whose generation didn't deliver both the visible
    // pieces (image + title) — we can't show a meaningful before/after.
    if (!aiImage || !aiTitleRaw || aiTitleRaw.trim().length === 0) continue;
    if (!sourceImage) continue;

    return {
      auditId: audit.id,
      domain: audit.domain,
      platform: audit.platform,
      productSourceId: sourceId,
      sourceTitle: candidate.title,
      aiTitle: aiTitleRaw,
      sourceImage,
      aiImage
    };
  }

  return null;
}

function ShowcaseCard({
  item,
  sourceLabel,
  aiLabel
}: {
  item: ShowcaseItem;
  sourceLabel: string;
  aiLabel: string;
}) {
  return (
    <Card variant="secondary" className="p-0 flex flex-col overflow-hidden">
      <div className="grid grid-cols-2 aspect-[2/1] bg-[var(--default)]">
        <div className="relative">
          {item.sourceImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.sourceImage}
              alt={item.sourceTitle}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-[var(--muted)]">
              —
            </div>
          )}
          <span className="absolute top-1.5 right-1.5 text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">
            {sourceLabel}
          </span>
        </div>
        <div className="relative border-l border-[var(--border)]">
          {item.aiImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.aiImage}
              alt={item.aiTitle}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-[var(--muted)]">
              —
            </div>
          )}
          <span className="absolute top-1.5 left-1.5 text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold">
            {aiLabel}
          </span>
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-[var(--muted)] line-clamp-1">
            <span className="font-mono uppercase tracking-wider mr-1.5">
              {sourceLabel}:
            </span>
            {item.sourceTitle}
          </p>
          <p className="text-sm font-semibold line-clamp-2">
            <span className="font-mono uppercase tracking-wider mr-1.5 text-[10px] text-[var(--accent)]">
              {aiLabel}:
            </span>
            {item.aiTitle}
          </p>
        </div>
        <div className="flex items-center mt-auto pt-2 border-t border-[var(--border)]">
          <span className="text-xs text-[var(--muted)] font-mono truncate">
            {item.domain}
          </span>
        </div>
      </div>
    </Card>
  );
}
