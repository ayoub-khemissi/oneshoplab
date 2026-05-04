import puppeteer from "puppeteer";

// ─── Platform Detection ────────────────────────────────────────────

/**
 * Detect the e-commerce platform from page HTML and headers.
 */
function detectPlatform(html, headers = {}) {
  const h = html.toLowerCase();

  // Shopify
  if (
    h.includes("shopify") ||
    h.includes("cdn.shopify.com") ||
    headers["x-shopify-stage"] ||
    headers["x-sorting-hat-shopid"]
  ) {
    return "Shopify";
  }

  // WooCommerce (WordPress)
  if (
    h.includes("woocommerce") ||
    h.includes("wc-block") ||
    h.includes("wp-content") ||
    h.includes("wordpress")
  ) {
    return "WooCommerce";
  }

  // Wix
  if (
    h.includes("wix.com") ||
    h.includes("wixsite.com") ||
    h.includes("x-wix") ||
    h.includes("_wix_browser_sess")
  ) {
    return "Wix";
  }

  // PrestaShop
  if (h.includes("prestashop") || h.includes("presta")) {
    return "PrestaShop";
  }

  return "Unknown";
}

// ─── Email Extraction ──────────────────────────────────────────────

/**
 * Standard email regex — broad enough to catch most addresses,
 * strict enough to avoid false positives.
 */
const EMAIL_RE =
  /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+/g;

/**
 * Patterns to exclude — images, stylesheets, tracking pixels, etc.
 */
const JUNK_PATTERNS = [
  /\.(?:png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot)$/i,
  /sentry/i,
  /webpack/i,
  /example\.com/i,
  /test@/i,
  /noreply/i,
  /no-reply/i,
  /@sentry/i,
  /@wix\.com$/i,
  /@shopify\.com$/i,
  /@wordpress\.\w+$/i,
  /@wp\.\w+$/i,
  /@email\.com$/i,
  /@domain\.com$/i,
  /@yoursite/i,
  /@your-?domain/i,
  /@change\.me/i,
];

function isJunkEmail(email) {
  return JUNK_PATTERNS.some((p) => p.test(email));
}

/**
 * Extract all plausible emails from a string of HTML / text.
 */
function extractEmails(text) {
  const raw = text.match(EMAIL_RE) || [];
  // Also decode obfuscated patterns like contact [at] domain [dot] com
  const deobfuscated = text
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".");
  const extra = deobfuscated.match(EMAIL_RE) || [];

  const all = [...raw, ...extra]
    .map((e) => e.toLowerCase().trim())
    .filter((e) => !isJunkEmail(e));

  return [...new Set(all)];
}

// ─── Page Paths to Crawl ──────────────────────────────────────────

const COMMON_PATHS = [
  "/",
  "/contact",
  "/contact-us",
  "/contactez-nous",
  "/about",
  "/about-us",
  "/a-propos",
  "/pages/contact",
  "/pages/about",
  "/pages/about-us",
  "/pages/contactez-nous",
  "/privacy-policy",
  "/policies/privacy-policy",
  "/politique-de-confidentialite",
  "/mentions-legales",
  "/legal",
  "/legal-notice",
  "/impressum",
  "/cgv",
  "/terms",
  "/terms-of-service",
];

const WOOCOMMERCE_EXTRA = [
  "/wp-json/wp/v2/pages?per_page=50",
];

// ─── Core Scraper ─────────────────────────────────────────────────

/**
 * Scrape a single store URL for contact emails.
 *
 * @param {string} baseUrl - The store's root URL.
 * @param {object} opts - Options: timeout, delay, headless.
 * @returns {{ url, platform, emails, sources }}
 */
export async function scrapeEmails(baseUrl, opts = {}) {
  const { timeout = 15000, delay = 1000, headless = true } = opts;

  const browser = await puppeteer.launch({
    headless: headless ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const collectedEmails = new Map(); // email → Set<source>

  function addEmails(emails, source) {
    for (const email of emails) {
      if (!collectedEmails.has(email)) {
        collectedEmails.set(email, new Set());
      }
      collectedEmails.get(email).add(source);
    }
  }

  let platform = "Unknown";

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" });

    // ── 1. Load home page and detect platform ──
    const response = await page.goto(baseUrl, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    const headers = response ? response.headers() : {};
    const homeHtml = await page.content();
    platform = detectPlatform(homeHtml, headers);

    // Extract from home page
    const homeEmails = extractEmails(homeHtml);
    addEmails(homeEmails, "/");

    // Also extract mailto: links via DOM
    const mailtoEmails = await extractMailtoFromPage(page);
    addEmails(mailtoEmails, "/ (mailto)");

    console.log(
      `  ⟶  Platform: ${platform} | Home: ${homeEmails.length} email(s)`
    );

    // ── 2. Build path list ──
    const paths = [...COMMON_PATHS];
    if (platform === "WooCommerce") {
      paths.push(...WOOCOMMERCE_EXTRA);
    }

    // Also discover links from the page itself
    const discoveredPaths = await discoverLinks(page, baseUrl);
    for (const p of discoveredPaths) {
      if (!paths.includes(p)) paths.push(p);
    }

    // ── 3. Crawl each path ──
    const visited = new Set(["/"]);

    for (const path of paths) {
      if (visited.has(path)) continue;
      visited.add(path);

      const fullUrl = new URL(path, baseUrl).href;

      try {
        const resp = await page.goto(fullUrl, {
          waitUntil: "domcontentloaded",
          timeout,
        });

        if (!resp || resp.status() >= 400) continue;

        // Wait a bit for JS rendering (especially Wix)
        if (platform === "Wix") {
          await page.waitForNetworkIdle({ idleTime: 1500, timeout: 8000 }).catch(() => {});
        }

        const html = await page.content();
        const emails = extractEmails(html);
        const mailto = await extractMailtoFromPage(page);

        if (emails.length > 0 || mailto.length > 0) {
          console.log(
            `  ⟶  ${path}: ${emails.length + mailto.length} email(s)`
          );
        }

        addEmails(emails, path);
        addEmails(mailto, `${path} (mailto)`);

        // Rate limiting
        await sleep(delay);
      } catch {
        // Page not found or timeout — skip
      }
    }
  } finally {
    await browser.close();
  }

  // Build final result
  const emails = [...collectedEmails.keys()];
  const sources = [
    ...new Set(
      [...collectedEmails.values()].flatMap((s) => [...s])
    ),
  ];

  return { url: baseUrl, platform, emails, sources };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Extract emails from mailto: links in the current page DOM.
 */
async function extractMailtoFromPage(page) {
  try {
    return await page.evaluate(() => {
      const links = document.querySelectorAll('a[href^="mailto:"]');
      return [...links]
        .map((a) => {
          const href = a.getAttribute("href") || "";
          return href.replace("mailto:", "").split("?")[0].toLowerCase().trim();
        })
        .filter((e) => e.includes("@"));
    });
  } catch {
    return [];
  }
}

/**
 * Discover internal links that might be contact/about pages.
 */
async function discoverLinks(page, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const links = await page.evaluate(() => {
      return [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .filter(Boolean);
    });

    const contactKeywords = [
      "contact",
      "about",
      "propos",
      "legal",
      "mention",
      "privacy",
      "confidentialite",
      "impressum",
      "cgv",
      "terms",
      "politique",
    ];

    const paths = new Set();
    for (const href of links) {
      try {
        const u = new URL(href, baseUrl);
        if (u.hostname !== base.hostname) continue;
        const path = u.pathname;
        if (contactKeywords.some((kw) => path.toLowerCase().includes(kw))) {
          paths.add(path);
        }
      } catch {
        // invalid URL
      }
    }

    return [...paths];
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
