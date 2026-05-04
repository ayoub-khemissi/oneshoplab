const TIMEOUT_MS = 20_000;
const UA = 'oneshoplab-audit/0.2';
const PAGE_SIZE = 250;
const MAX_PAGES = 4;
const WORST_N = 10;
const BEST_N = 5;

interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
}
interface ShopifyVariant {
  id: number;
  price: string;
  sku: string;
  available: boolean;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  tags: string[] | string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
}

interface ProductInsight {
  id: number;
  handle: string;
  title: string;
  url: string;
  score: number;
  issues: string[];
  signals: {
    title_length: number;
    description_text_length: number;
    description_has_structure: boolean;
    image_count: number;
    images_with_alt: number;
    smallest_image_width: number | null;
    variant_count: number;
    tag_count: number;
    tags: string[];
    vendor: string;
    product_type: string;
    price_min: number;
    price_max: number;
    last_updated: string;
  };
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA },
      redirect: 'follow'
    });
    if (!r.ok) return { ok: false, status: r.status, data: null };
    const txt = await r.text();
    try {
      return { ok: true, status: r.status, data: JSON.parse(txt) as T };
    } catch {
      return { ok: false, status: r.status, data: null };
    }
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function normalizeRoot(input: string): string {
  const u = new URL(input.startsWith('http') ? input : `https://${input}`);
  return `${u.protocol}//${u.hostname}`;
}

function normalizeTags(t: unknown): string[] {
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreProduct(p: ShopifyProduct, root: string): ProductInsight {
  const html = p.body_html ?? '';
  const text = html.replace(/<[^>]*>/g, '').trim();
  const titleLen = (p.title ?? '').length;
  const descLen = text.length;
  const imgs = p.images ?? [];
  const altCovered = imgs.filter((i) => i.alt && i.alt.trim().length > 0).length;
  const tags = normalizeTags(p.tags);
  const variants = p.variants ?? [];
  const structured = /<(ul|ol|li|h[1-6]|table)/i.test(html);
  const prices = variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));
  const widths = imgs.map((i) => i.width).filter((w) => typeof w === 'number' && w > 0);
  const minWidth = widths.length > 0 ? Math.min(...widths) : null;

  const issues: string[] = [];
  if (imgs.length === 0) issues.push('Aucune image');
  else if (imgs.length === 1) issues.push('Une seule image (pas de visuels alternatifs)');
  if (descLen === 0) issues.push('Description manquante');
  else if (descLen < 100) issues.push('Description très courte (<100 caractères)');
  else if (!structured && descLen < 300) issues.push('Description sans structure (mur de texte)');
  if (titleLen < 20) issues.push('Titre très court');
  if (tags.length === 0) issues.push('Aucun tag');
  if (imgs.length > 0 && altCovered < imgs.length) {
    issues.push(`Alt text manquant sur ${imgs.length - altCovered}/${imgs.length} image${imgs.length > 1 ? 's' : ''}`);
  }
  if (minWidth !== null && minWidth < 800) {
    issues.push(`Image basse résolution (min ${minWidth}px de large)`);
  }

  const imgScore =
    imgs.length >= 4 ? 100 : imgs.length === 3 ? 85 : imgs.length === 2 ? 65 : imgs.length === 1 ? 35 : 0;
  const descScore =
    descLen === 0 ? 0 : descLen < 100 ? 25 : descLen < 300 ? 60 : descLen < 600 ? 85 : 100;
  const structureBonus = structured ? 1 : 0.85;
  const tagScore = tags.length >= 5 ? 100 : tags.length >= 3 ? 70 : tags.length >= 1 ? 40 : 0;
  const titleScore =
    titleLen >= 30 && titleLen <= 70 ? 100 : titleLen >= 20 ? 70 : titleLen > 0 ? 40 : 0;
  const altScore = imgs.length === 0 ? 0 : (altCovered / imgs.length) * 100;

  const score = Math.round(
    clamp(
      0.30 * imgScore +
        0.30 * descScore * structureBonus +
        0.15 * tagScore +
        0.15 * titleScore +
        0.10 * altScore
    )
  );

  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    url: `${root}/products/${p.handle}`,
    score,
    issues,
    signals: {
      title_length: titleLen,
      description_text_length: descLen,
      description_has_structure: structured,
      image_count: imgs.length,
      images_with_alt: altCovered,
      smallest_image_width: minWidth,
      variant_count: variants.length,
      tag_count: tags.length,
      tags,
      vendor: p.vendor ?? '',
      product_type: p.product_type ?? '',
      price_min: prices.length ? Math.min(...prices) : 0,
      price_max: prices.length ? Math.max(...prices) : 0,
      last_updated: p.updated_at
    }
  };
}

async function fetchAllProducts(root: string): Promise<{ products: ShopifyProduct[]; pagesFetched: number; likelyMore: boolean }> {
  const all: ShopifyProduct[] = [];
  let pageReached = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchJson<{ products: ShopifyProduct[] }>(
      `${root}/products.json?limit=${PAGE_SIZE}&page=${page}`
    );
    if (!r.ok || !r.data?.products) break;
    pageReached = page;
    all.push(...r.data.products);
    console.log(`  page ${page}: +${r.data.products.length}`);
    if (r.data.products.length < PAGE_SIZE) break;
  }
  return { products: all, pagesFetched: pageReached, likelyMore: pageReached === MAX_PAGES && all.length === MAX_PAGES * PAGE_SIZE };
}

async function fetchStoreMeta(root: string): Promise<{ currency: string | null; locale: string | null }> {
  const [homeBody, cartBody] = await Promise.all([
    fetch(root, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA }, redirect: 'follow' })
      .then((r) => r.text())
      .catch(() => ''),
    fetch(`${root}/cart.js`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA }, redirect: 'follow' })
      .then((r) => r.text())
      .catch(() => '')
  ]);
  const localeMatch = homeBody.match(/<html[^>]+lang=["']([^"']+)["']/i);
  let currency: string | null = null;
  try {
    const c = JSON.parse(cartBody);
    currency = c?.currency ?? null;
  } catch {
    /* ignore */
  }
  return { currency, locale: localeMatch?.[1] ?? null };
}

function tally(items: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return Array.from(m, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

async function audit(input: string) {
  const root = normalizeRoot(input);
  console.log(`Auditing ${root}...`);
  const { products, pagesFetched, likelyMore } = await fetchAllProducts(root);
  if (products.length === 0) {
    throw new Error('No products fetched (not Shopify, password-protected, or endpoint disabled)');
  }
  console.log(`  total: ${products.length} products${likelyMore ? ' (truncated at page limit)' : ''}`);

  const { currency, locale } = await fetchStoreMeta(root);
  console.log(`  store: currency=${currency}, locale=${locale}`);

  const insights = products.map((p) => scoreProduct(p, root));
  const sorted = [...insights].sort((a, b) => a.score - b.score);

  let i0 = 0, i1 = 0, i2 = 0, i3p = 0;
  let de = 0, ds = 0, dm = 0, dl = 0;
  let dstr = 0, dpl = 0;
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
  let na = 0, pa = 0, fa = 0;
  let lowResImgs = 0;
  let lastAdd = '', lastUpd = '';
  let totalImgs = 0, totalDesc = 0, totalTags = 0, totalVar = 0, totalTitle = 0;
  const allVendors: string[] = [];
  const allTypes: string[] = [];
  const allTags: string[] = [];

  for (const p of insights) {
    const s = p.signals;
    if (s.image_count === 0) i0++;
    else if (s.image_count === 1) i1++;
    else if (s.image_count === 2) i2++;
    else i3p++;

    if (s.description_text_length === 0) de++;
    else if (s.description_text_length < 100) ds++;
    else if (s.description_text_length < 500) dm++;
    else dl++;
    if (s.description_has_structure) dstr++;
    else if (s.description_text_length > 0) dpl++;

    if (s.tag_count === 0) t0++;
    else if (s.tag_count <= 3) t1++;
    else if (s.tag_count <= 10) t2++;
    else t3++;

    if (s.image_count === 0 || s.images_with_alt === 0) na++;
    else if (s.images_with_alt < s.image_count) pa++;
    else fa++;

    if (s.smallest_image_width !== null && s.smallest_image_width < 800) lowResImgs++;

    totalImgs += s.image_count;
    totalDesc += s.description_text_length;
    totalTags += s.tag_count;
    totalVar += s.variant_count;
    totalTitle += s.title_length;

    if (s.vendor) allVendors.push(s.vendor);
    if (s.product_type) allTypes.push(s.product_type);
    allTags.push(...s.tags);
  }

  for (const p of products) {
    if (p.created_at && p.created_at > lastAdd) lastAdd = p.created_at;
    if (p.updated_at && p.updated_at > lastUpd) lastUpd = p.updated_at;
  }

  const n = insights.length;

  const completenessScore = clamp(
    (insights.filter((p) => p.signals.image_count > 0 && p.signals.description_text_length > 0).length / n) * 100
  );
  const copyScore = clamp(
    insights.reduce((sum, p) => {
      const dl = p.signals.description_text_length;
      const part = dl === 0 ? 0 : dl < 100 ? 25 : dl < 300 ? 60 : dl < 600 ? 85 : 100;
      const b = p.signals.description_has_structure ? 1 : 0.85;
      return sum + part * b;
    }, 0) / n
  );
  const visualScore = clamp(
    insights.reduce((sum, p) => {
      const ic = p.signals.image_count;
      const part = ic >= 4 ? 100 : ic === 3 ? 85 : ic === 2 ? 65 : ic === 1 ? 35 : 0;
      return sum + part;
    }, 0) / n
  );
  const tagScore = clamp(
    insights.reduce((sum, p) => {
      const tc = p.signals.tag_count;
      const part = tc >= 5 ? 100 : tc >= 3 ? 70 : tc >= 1 ? 40 : 0;
      return sum + part;
    }, 0) / n
  );
  const overall = Math.round((completenessScore + copyScore + visualScore + tagScore) / 4);
  const avgScore = Math.round(insights.reduce((s, p) => s + p.score, 0) / n);

  return {
    domain: new URL(root).hostname,
    resolved_url: root,
    is_shopify: true,
    store_meta: { currency, locale },
    catalog: {
      sampled: n,
      pages_fetched: pagesFetched,
      likely_more: likelyMore,
      last_added: lastAdd || null,
      last_updated: lastUpd || null,
      avg_image_count: +(totalImgs / n).toFixed(2),
      avg_description_length: Math.round(totalDesc / n),
      avg_tag_count: +(totalTags / n).toFixed(2),
      avg_variant_count: +(totalVar / n).toFixed(2),
      avg_title_length: Math.round(totalTitle / n),
      low_res_image_products: lowResImgs,
      distribution: {
        images_0: i0,
        images_1: i1,
        images_2: i2,
        images_3plus: i3p,
        desc_empty: de,
        desc_short_lt100: ds,
        desc_medium_100_500: dm,
        desc_long_gt500: dl,
        desc_structured: dstr,
        desc_plain_wall: dpl,
        tags_0: t0,
        tags_1to3: t1,
        tags_4to10: t2,
        tags_11plus: t3,
        no_alt_text: na,
        partial_alt_text: pa,
        full_alt_text: fa
      },
      top_vendors: tally(allVendors).slice(0, 5),
      top_product_types: tally(allTypes).slice(0, 5),
      top_tags: tally(allTags).slice(0, 10)
    },
    scores: {
      catalog_completeness: Math.round(completenessScore),
      copy_quality: Math.round(copyScore),
      visual_quality: Math.round(visualScore),
      tagging_quality: Math.round(tagScore),
      overall
    },
    avg_product_score: avgScore,
    worst_products: sorted.slice(0, WORST_N),
    best_products: sorted.slice(-BEST_N).reverse()
  };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: tsx src/audit.ts <url>');
    process.exit(1);
  }
  try {
    const r = await audit(url);
    console.log('\n=== REPORT (JSON) ===');
    console.log(JSON.stringify(r, null, 2));
    console.log('\n=== SCORES ===');
    console.log(`Catalog Completeness:  ${r.scores.catalog_completeness}/100`);
    console.log(`Copy Quality:          ${r.scores.copy_quality}/100`);
    console.log(`Visual Quality:        ${r.scores.visual_quality}/100`);
    console.log(`Tagging Quality:       ${r.scores.tagging_quality}/100`);
    console.log(`OVERALL:               ${r.scores.overall}/100`);
    console.log(`Avg product score:     ${r.avg_product_score}/100`);
    console.log(`\n=== TOP ${r.worst_products.length} WORST PRODUCTS (best optim candidates) ===`);
    for (const p of r.worst_products) {
      console.log(`  [${p.score}/100] ${p.title}`);
      console.log(`    ${p.url}`);
      console.log(`    Issues: ${p.issues.join(' | ') || '—'}`);
    }
  } catch (e) {
    console.error('Audit failed:', (e as Error).message);
    process.exit(1);
  }
}

main();
