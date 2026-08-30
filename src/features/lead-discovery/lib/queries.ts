// ---------------------------------------------------------------------------
// Built-in query templates per platform × locale
// ---------------------------------------------------------------------------

/**
 * High-yield search query templates. Each template combines:
 *   - a platform footprint that *only* shops trigger (URL patterns
 *     like `inurl:/products/` or `inurl:/collections/` for Shopify,
 *     `inurl:/?product=` for WC, `wixsite.com` host for Wix),
 *   - a French-side or English-side cart phrase to filter out
 *     non-shop pages that happen to mention "shopify".
 *
 * The result of running all templates for a given (platform, country)
 * dedupes to a much richer candidate pool than any single query —
 * Brave caps each query at 200 results, so 5 well-chosen templates
 * scale you to ~1000 unique candidates per session.
 */
type Platform = 'shopify' | 'woocommerce' | 'wix';

// Negative keywords appended to every Shopify/WC query to filter out
// the consistent noise: agencies, training/tutorials, reviews, the
// platform's own docs, app vendors. Big yield boost on the FR market
// where the SEO is dominated by ecommerce-consultancy content.
const NEG_GENERIC =
  '-formation -agence -agency -tutoriel -tutorial -avis -review -blog -consultant -consulting -agency -prestation -services -comparatif';

const QUERY_TEMPLATES: Record<Platform, Record<string, string[]>> = {
  shopify: {
    fr: [
      // Highest precision: myshopify.com is by-definition a Shopify shop.
      'inurl:myshopify.com -inurl:help -inurl:community -inurl:partners',
      // Direct product-API endpoint: only Shopify storefronts expose it.
      'inurl:/products.json site:.fr',
      // Collection pages with a French cart phrase.
      `inurl:/collections/ "ajouter au panier" ${NEG_GENERIC}`,
      // Product pages with shipping + cart phrases.
      `inurl:/products/ "livraison" "panier" site:.fr ${NEG_GENERIC}`,
      // Native footer footprint, restricted to the FR TLD to drop
      // English-language sites that mention the phrase.
      `"propulsé par shopify" site:.fr ${NEG_GENERIC}`,
      `"powered by shopify" site:.fr ${NEG_GENERIC}`
    ],
    en: [
      'inurl:myshopify.com -inurl:help -inurl:community -inurl:partners',
      'inurl:/products.json',
      `inurl:/collections/ "add to cart" ${NEG_GENERIC}`,
      `inurl:/products/ "shipping" "checkout" ${NEG_GENERIC}`,
      `"powered by shopify" "add to cart" ${NEG_GENERIC}`
    ],
    es: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.es',
      `inurl:/collections/ "añadir al carrito" ${NEG_GENERIC}`,
      `inurl:/products/ "envío" "carrito" site:.es ${NEG_GENERIC}`,
      `"con tecnología de shopify" site:.es ${NEG_GENERIC}`
    ],
    de: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.de',
      `inurl:/collections/ "in den warenkorb" ${NEG_GENERIC}`,
      `inurl:/products/ "versand" "warenkorb" site:.de ${NEG_GENERIC}`,
      `"unterstützt von shopify" site:.de ${NEG_GENERIC}`
    ],
    it: [
      'inurl:myshopify.com -inurl:help -inurl:community',
      'inurl:/products.json site:.it',
      `inurl:/collections/ "aggiungi al carrello" ${NEG_GENERIC}`,
      `inurl:/products/ "spedizione" "carrello" site:.it ${NEG_GENERIC}`,
      `"sviluppato da shopify" site:.it ${NEG_GENERIC}`
    ]
  },
  woocommerce: {
    fr: [
      // ?product=ID is the WP-default permalink for products; combined
      // with the FR cart phrase it's a strong shop signal.
      `inurl:?product= "ajouter au panier" ${NEG_GENERIC}`,
      `inurl:/produit/ "ajouter au panier" site:.fr ${NEG_GENERIC}`,
      `inurl:/boutique/ "ajouter au panier" site:.fr ${NEG_GENERIC}`,
      `"propulsé par woocommerce" site:.fr ${NEG_GENERIC}`,
      `"wp-content" "woocommerce" "panier" site:.fr ${NEG_GENERIC}`
    ],
    en: [
      `inurl:?product= "add to cart" ${NEG_GENERIC}`,
      `inurl:/product/ "add to cart" "checkout" ${NEG_GENERIC}`,
      `inurl:/shop/ "add to cart" "checkout" ${NEG_GENERIC}`,
      `"proudly powered by woocommerce" ${NEG_GENERIC}`,
      `"wp-content/plugins/woocommerce" "add to cart" ${NEG_GENERIC}`
    ],
    es: [
      `inurl:?product= "añadir al carrito" ${NEG_GENERIC}`,
      `inurl:/producto/ "añadir al carrito" site:.es ${NEG_GENERIC}`,
      `inurl:/tienda/ "añadir al carrito" site:.es ${NEG_GENERIC}`,
      `"funciona con woocommerce" site:.es ${NEG_GENERIC}`
    ],
    de: [
      `inurl:?product= "in den warenkorb" ${NEG_GENERIC}`,
      `inurl:/produkt/ "in den warenkorb" site:.de ${NEG_GENERIC}`,
      `inurl:/shop/ "in den warenkorb" site:.de ${NEG_GENERIC}`,
      `"stolz präsentiert von woocommerce" site:.de ${NEG_GENERIC}`
    ],
    it: [
      `inurl:?product= "aggiungi al carrello" ${NEG_GENERIC}`,
      `inurl:/prodotto/ "aggiungi al carrello" site:.it ${NEG_GENERIC}`,
      `inurl:/negozio/ "aggiungi al carrello" site:.it ${NEG_GENERIC}`,
      `"con orgoglio basato su woocommerce" site:.it ${NEG_GENERIC}`
    ]
  },
  wix: {
    fr: [
      'site:wixsite.com "boutique" "panier"',
      'site:wixsite.com inurl:/shop',
      'site:wixsite.com inurl:/product-page'
    ],
    en: [
      'site:wixsite.com "shop" "cart"',
      'site:wixsite.com inurl:/shop',
      'site:wixsite.com inurl:/product-page',
      '"made with wix" inurl:wixsite.com'
    ],
    es: ['site:wixsite.com "tienda" "carrito"', 'site:wixsite.com inurl:/shop'],
    de: ['site:wixsite.com "shop" "warenkorb"', 'site:wixsite.com inurl:/shop'],
    it: ['site:wixsite.com "negozio" "carrello"', 'site:wixsite.com inurl:/shop']
  }
};

export function getQueryTemplates(platform: Platform, country: string | undefined): string[] {
  const lang = (country ?? 'en').toLowerCase();
  const table = QUERY_TEMPLATES[platform];
  return table[lang] ?? table['en'] ?? [];
}

// ---------------------------------------------------------------------------
// Niche-based queries
//
// Brave's index is poor on technical operators (`inurl:`, `site:` on
// platform TLDs) but rich on natural-language queries — searching for
// "boutique mode féminine en ligne" returns 10/10 real shops. Use this
// when you want to fish for real merchants without filtering by
// platform upfront (the qualifier handles platform detection on each
// candidate).
// ---------------------------------------------------------------------------

const NICHE_QUERIES: Record<string, string[]> = {
  fr: [
    'boutique mode féminine en ligne',
    'boutique mode masculine en ligne',
    'cosmétique bio boutique en ligne',
    'bijoux artisanaux boutique en ligne',
    'maison déco boutique en ligne',
    'vêtements enfants boutique en ligne',
    'équipement sport boutique en ligne',
    'alimentation bio boutique en ligne',
    'maroquinerie boutique en ligne',
    'lingerie boutique en ligne',
    'chaussures boutique en ligne',
    'accessoires mode boutique en ligne',
    'produits bébé boutique en ligne',
    'soins cheveux boutique en ligne',
    'thé café boutique en ligne'
  ],
  en: [
    'womens fashion online shop',
    'mens fashion online shop',
    'organic cosmetics online shop',
    'handmade jewelry online shop',
    'home decor online shop',
    'kids clothing online shop',
    'sports equipment online shop',
    'organic food online shop',
    'leather goods online shop',
    'lingerie online shop',
    'shoes online shop',
    'fashion accessories online shop',
    'baby products online shop',
    'hair care online shop',
    'tea coffee online shop'
  ],
  es: [
    'moda mujer tienda online',
    'moda hombre tienda online',
    'cosmética natural tienda online',
    'joyería artesanal tienda online',
    'decoración hogar tienda online',
    'ropa infantil tienda online',
    'deporte tienda online'
  ],
  de: [
    'damenmode online shop',
    'herrenmode online shop',
    'naturkosmetik online shop',
    'handgemachter schmuck online shop',
    'wohnaccessoires online shop',
    'kinderkleidung online shop',
    'sportausrüstung online shop'
  ],
  it: [
    'moda donna negozio online',
    'moda uomo negozio online',
    'cosmetica bio negozio online',
    'gioielli artigianali negozio online',
    'arredamento casa negozio online'
  ]
};

export function getNicheQueries(country: string | undefined): string[] {
  const lang = (country ?? 'en').toLowerCase();
  return NICHE_QUERIES[lang] ?? NICHE_QUERIES['en'];
}
