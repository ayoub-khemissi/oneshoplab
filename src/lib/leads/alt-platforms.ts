/**
 * Discovery + fingerprinting for e-commerce platforms outside the
 * three we auto-audit natively (Shopify / WooCommerce / Wix).
 *
 * The native adapter pipeline can't parse a Magento / PrestaShop /
 * BigCommerce / Squarespace store's catalog programmatically, so these
 * leads can't go through `qualifyUrl` — they'd all be skipped on
 * `platform_not_detected`. Instead we:
 *
 *   1. Run a set of Brave queries crafted for each platform's
 *      best-known footprints (powered-by phrases, URL patterns,
 *      asset hosts).
 *   2. For every candidate the queries return, fetch the HTML and run
 *      a fingerprint check that confirms the platform — Brave's
 *      precision is decent on these footprints but not great, the
 *      fingerprint cuts the false-positive rate to ~5%.
 *   3. Also confirm the candidate has an actual product catalog
 *      (Schema.org Product / OG type product / a product-URL match)
 *      so we drop blog posts, agencies, doc sites etc.
 *   4. Scrape contact info with the existing contact-scraper and
 *      upsert the lead as `platform='manual'` (the catch-all enum
 *      value; the real detected platform goes into `notes` so the
 *      operator can grep / filter).
 *
 * Keeping `platform='manual'` instead of extending the PLATFORMS enum
 * avoids a schema migration and means the existing cold script
 * already classifies these leads via `platformCategory()` — they fall
 * outside merchant/agency for now (we'll add a `merchant_manual`
 * variant in a follow-up once the discovery output looks right).
 */

export type AltPlatform = 'magento' | 'prestashop' | 'bigcommerce' | 'squarespace';

export const ALT_PLATFORMS: readonly AltPlatform[] = [
  'magento',
  'prestashop',
  'bigcommerce',
  'squarespace'
] as const;

// -----------------------------------------------------------------------------
// Brave query templates per (platform, country)
// -----------------------------------------------------------------------------
//
// Each query needs:
//   - a footprint specific enough to be platform-positive (rare on
//     non-platform pages),
//   - a cart/shop phrase in the target language so we keep merchants
//     and drop docs / agencies / training content,
//   - negative keywords to push out the consistent SERP noise.
//
// Negative keyword block, shared. Magento/PS/BC SERPs are heavy on
// agency content, courses, comparison articles — these knock them
// out without dropping real shops. Brave reacts poorly to long
// negative lists (>10 terms returned 0 hits on smoke tests), so we
// keep this to the 6 highest-yield filters.
const NEG = '-formation -agence -tutoriel -documentation -theme -template';

const QUERIES: Record<AltPlatform, Record<'fr' | 'en', string[]>> = {
  magento: {
    fr: [
      // "Powered by Magento" footer (FR sites with the English phrase
      // are common because many themes don't translate it).
      `"powered by Magento" ${NEG}`,
      // catalogsearch is a Magento URL convention — almost zero
      // false positives.
      `inurl:catalogsearch ${NEG}`,
      // checkout/cart URL + a French cart phrase.
      `inurl:"/checkout/cart" "ajouter au panier" ${NEG}`,
      // Magento Commerce branding / generator meta is rare but very
      // high-precision when present.
      `intext:"Magento Commerce" ${NEG}`
    ],
    en: [
      `"powered by Magento" ${NEG}`,
      `inurl:catalogsearch ${NEG}`,
      `inurl:"/checkout/cart" "add to cart" ${NEG}`,
      `intext:"Magento Commerce" ${NEG}`
    ]
  },
  prestashop: {
    fr: [
      // Powered-by phrase in both languages — French shops often
      // forget to translate the footer.
      `"propulsé par prestashop" ${NEG}`,
      `"powered by prestashop" ${NEG}`,
      // ?id_product= is the legacy PS URL pattern (still active on
      // many production sites that didn't migrate to friendly URLs).
      `inurl:"id_product=" ${NEG}`,
      // Friendly-URL convention introduced in PS 1.7.
      `inurl:"/categorie/" "ajouter au panier" ${NEG}`
    ],
    en: [
      `"powered by prestashop" ${NEG}`,
      `inurl:"id_product=" ${NEG}`,
      `inurl:"/category/" "add to cart" prestashop ${NEG}`
    ]
  },
  bigcommerce: {
    fr: [
      // Storefront convention: stores live at *.mybigcommerce.com
      // pre-launch and migrate to custom domains in prod.
      `"powered by BigCommerce" ${NEG}`,
      `inurl:mybigcommerce.com -inurl:help`,
      `intext:"BigCommerce" "panier" ${NEG}`
    ],
    en: [
      `"powered by BigCommerce" ${NEG}`,
      `inurl:mybigcommerce.com -inurl:help`,
      `intext:"BigCommerce" "add to cart" ${NEG}`
    ]
  },
  squarespace: {
    fr: [
      // Static asset CDN is the most reliable Squarespace marker —
      // even sites on custom domains pull from static1.squarespace.com.
      `"static1.squarespace.com" "boutique" ${NEG}`,
      `"static1.squarespace.com" "panier" ${NEG}`
    ],
    en: [
      `"static1.squarespace.com" "shop" "add to cart" ${NEG}`,
      `"static1.squarespace.com" "online store" ${NEG}`,
      `"Built with Squarespace" "shop" ${NEG}`
    ]
  }
};

export function altPlatformQueries(platform: AltPlatform, lang: 'fr' | 'en'): string[] {
  return QUERIES[platform][lang] ?? [];
}

// -----------------------------------------------------------------------------
// Fingerprint detector
// -----------------------------------------------------------------------------
//
// Each platform gets a list of regex patterns we look for in the raw
// HTML response. We score by counting matches — needing >=1 strong
// match (host-level or `<meta generator>`) OR >=2 weaker matches
// (class/asset hints) before declaring a hit. This bias keeps the
// false-positive rate below the false-negative rate, which is what
// we want for cold prospection (we'd rather miss 10 shops than mail
// 1 wrong vendor).

interface FingerprintRule {
  /** RegExp source. */
  pattern: RegExp;
  /** True = a single match is enough to confirm the platform. */
  strong: boolean;
}

const FINGERPRINTS: Record<AltPlatform, FingerprintRule[]> = {
  magento: [
    { pattern: /<meta\s+name=["']generator["']\s+content=["']Magento/i, strong: true },
    { pattern: /\bMage\.cookies\b/, strong: true },
    { pattern: /\bMagento_/, strong: true },
    { pattern: /\/static\/version\d+\//, strong: true },
    { pattern: /\bdata-mage-init\b/, strong: true },
    { pattern: /\/skin\/frontend\//, strong: false },
    { pattern: /\bmagento\b/i, strong: false }
  ],
  prestashop: [
    { pattern: /<meta\s+name=["']generator["']\s+content=["']PrestaShop/i, strong: true },
    { pattern: /\bprestashop\b/i, strong: false },
    { pattern: /\bps_version\b/, strong: true },
    { pattern: /\/themes\/default-bootstrap\//, strong: true },
    { pattern: /\/modules\/ps_/, strong: false },
    { pattern: /id="presta-/, strong: true }
  ],
  bigcommerce: [
    { pattern: /\bmybigcommerce\.com\b/i, strong: true },
    { pattern: /\bcdn\d+\.bigcommerce\.com\b/i, strong: true },
    { pattern: /<meta\s+name=["']generator["']\s+content=["']BigCommerce/i, strong: true },
    { pattern: /\bstencil-utils\b/, strong: true },
    { pattern: /\bbcapp\b/, strong: false },
    { pattern: /\bbigcommerce\b/i, strong: false }
  ],
  squarespace: [
    { pattern: /\bstatic1\.squarespace\.com\b/i, strong: true },
    { pattern: /<meta\s+name=["']generator["']\s+content=["']Squarespace/i, strong: true },
    { pattern: /\bSquarespace\.afterBodyLoad\b/, strong: true },
    { pattern: /\bsqs-block\b/, strong: false },
    { pattern: /\bsquarespace-cdn\.com\b/i, strong: true }
  ]
};

/**
 * Confirm whether the HTML belongs to the expected platform. Returns
 * the platform we matched (which can be a DIFFERENT one if the page
 * looks more like Magento than the expected PrestaShop, e.g.) or null
 * on no match.
 */
export function detectAltPlatform(html: string): AltPlatform | null {
  for (const platform of ALT_PLATFORMS) {
    let strong = 0;
    let weak = 0;
    for (const rule of FINGERPRINTS[platform]) {
      if (rule.pattern.test(html)) {
        if (rule.strong) strong += 1;
        else weak += 1;
      }
    }
    if (strong >= 1 || weak >= 2) return platform;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Has-products check
// -----------------------------------------------------------------------------
//
// Even with the platform confirmed we still want to drop docs / blog
// pages / agency content masquerading as a shop. Cheapest check: look
// for Product structured data OR an obvious cart phrase + a product
// URL pattern.

const PRODUCT_SCHEMA_RE = /"@type"\s*:\s*"Product"/i;
const PRODUCT_OG_RE = /<meta\s+property=["']og:type["']\s+content=["']product["']/i;
const CART_PHRASES = [
  /add to cart/i,
  /ajouter au panier/i,
  /buy now/i,
  /acheter maintenant/i,
  /a[ñn]adir al carrito/i,
  /in den warenkorb/i,
  /aggiungi al carrello/i
];
const PRODUCT_URL_HINTS = [
  /\/product\//i,
  /\/products\//i,
  /\/produit\//i,
  /\/produits\//i,
  /\/p\//i,
  /\bid_product=/i,
  /\bproduct_id=/i
];

export function looksLikeShop(html: string, url: string): boolean {
  // Strong signals first: Product structured data or OG type=product
  // is an explicit declaration that this page is a shop.
  if (PRODUCT_SCHEMA_RE.test(html)) return true;
  if (PRODUCT_OG_RE.test(html)) return true;
  // Softer signals: ANY cart phrase OR ANY product-URL hint passes.
  // Both was too strict — many homepages have one or the other but
  // not both (the home renders cart text in nav but no /product/
  // links until JS hydrates). Once we've confirmed the platform via
  // fingerprint, having a single shop-flavored signal is enough.
  const hasCart = CART_PHRASES.some((re) => re.test(html));
  if (hasCart) return true;
  const hasProductUrl = PRODUCT_URL_HINTS.some((re) => re.test(url) || re.test(html));
  return hasProductUrl;
}

/**
 * Domains that ALWAYS appear in alt-platform SERP results because
 * they're the platform's own docs, app vendors, agencies, blogs —
 * never the merchants we want. Dropping them at the candidate-list
 * level saves a fetch + fingerprint check per URL.
 */
export const ALT_PLATFORM_BLOCKED_DOMAINS = new Set<string>([
  'prestashop.com',
  'prestashop.fr',
  'forum.prestashop.com',
  'help-center.prestashop.com',
  'addons.prestashop.com',
  'devdocs.prestashop-project.org',
  'prestasoo.com',
  'mypresta.eu',
  'prestacrea.com',
  'magento.com',
  'devdocs.magento.com',
  'docs.magento.com',
  'community.magento.com',
  'bigcommerce.com',
  'developer.bigcommerce.com',
  'support.bigcommerce.com',
  'squarespace.com',
  'support.squarespace.com',
  'webflow.com',
  'university.webflow.com',
  // Generic noise.
  'web-alliance.fr',
  'appseconnect.com',
  'developando.com',
  'ionos.fr',
  'ionos.com',
  'aide.lws.fr',
  // Magento agencies + module vendors that consistently appear in
  // SERPs for the "powered by Magento" / catalogsearch footprints.
  'mageworx.com',
  'commercepundit.com',
  'magic42.co.uk',
  'mgt-commerce.com',
  'orienteed.com',
  'magentocommerce.fr',
  'hostduplex.com',
  'liquidweb.com',
  'netsolutions.com',
  'fasterize.com',
  'ex2.com',
  'adobe.com',
  'business.adobe.com',
  // Industry news / databases that index e-commerce stores.
  'storeleads.app',
  'indiamart.com',
  'businesswire.com',
  'finance.yahoo.com',
  'journaldunet.com',
  'pixartprinting.fr',
  'grafikart.fr',
  'colissimo.entreprise.laposte.fr',
  'docs.workato.com'
]);

export function isAltPlatformBlocked(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (ALT_PLATFORM_BLOCKED_DOMAINS.has(d)) return true;
  for (const blocked of ALT_PLATFORM_BLOCKED_DOMAINS) {
    if (d.endsWith(`.${blocked}`)) return true;
  }
  return false;
}
