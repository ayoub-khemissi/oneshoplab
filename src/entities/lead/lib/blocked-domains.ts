// ---------------------------------------------------------------------------
// Domains we never want to qualify — they show up in Shopify-related
// search results constantly but aren't merchants:
//   - Shopify's own properties (help, community, partners…)
//   - Aggregators / SaaS ecosystem (jotform, autods, spocket…)
//   - User-generated content sites (reddit, youtube, medium, x, …)
//   - Doc / marketing sites that *mention* shopify in the page body.
//
// Filtering at the discovery stage saves HTTP roundtrips on the
// qualifier and surfaces a much cleaner "candidates → qualified"
// conversion rate.
// ---------------------------------------------------------------------------

const BLOCKED_DOMAINS = new Set<string>([
  'shopify.com',
  'help.shopify.com',
  'community.shopify.com',
  'partners.shopify.com',
  'apps.shopify.com',
  'shop.app',
  'wix.com',
  'fr.wix.com',
  'support.wix.com',
  'wordpress.com',
  'wordpress.org',
  'woocommerce.com',
  'reddit.com',
  'medium.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'pinterest.com',
  'github.com',
  'stackoverflow.com',
  'quora.com',
  'play.google.com',
  'apps.apple.com',
  'wikipedia.org',
  'fr.wikipedia.org',
  'en.wikipedia.org',
  // Common Shopify ecosystem SaaS / docs / theme vendors. Extend
  // freely — false positives just mean a manual paste from the
  // operator is needed for those edge cases.
  'jotform.com',
  'autods.com',
  'spocket.co',
  'gempages.net',
  'klaviyo.com',
  'mailchimp.com',
  'gorgias.com',
  'recharge.com',
  'klarna.com',
  'shogun.com',
  'omnisend.com',
  'iubenda.com',
  'nudgify.com',
  'praella.com',
  'a2xaccounting.com',
  'zikanalytics.com',
  'valardigital.com',
  'omnithemes.com',
  'support.omnithemes.com',
  'oberlo.com',
  'paypal.com',
  'stripe.com'
]);

export function isBlockedDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (BLOCKED_DOMAINS.has(d)) return true;
  // Block all subdomains of shopify.com / wix.com / etc. with one rule.
  for (const blocked of BLOCKED_DOMAINS) {
    if (d.endsWith(`.${blocked}`)) return true;
  }
  return false;
}
