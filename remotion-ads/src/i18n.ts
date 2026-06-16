export const LOCALES = ["en", "fr", "es", "de", "it"] as const;
export type Locale = (typeof LOCALES)[number];

/** Stable keys for the 4 catalog products (hue/score/image live in the scene). */
export type ProductKey = "sneaker" | "watch" | "headphones" | "sunglasses";

export type Copy = {
  intro: { title1: string; title2: string; anyStore: string };
  import: {
    eyebrow: string;
    heading: string;
    issues: string;
    optimize: string;
    toast: string;
  };
  optimize: {
    visual: string;
    eyebrow: string;
    source: string;
    ai: string;
    generateAll: string;
    generating: string;
    regenerateAll: string;
    titleLabel: string;
    emptyTitle: string;
    descLabel: string;
    tagsLabel: string;
    imagesLabel: string;
    angles: { studio: string; lifestyle: string; inuse: string };
    score: (n: number) => string;
  };
  cta: { head1: string; head2: string; button: string; url: string };
  credits: (n: number) => string;
  products: Record<ProductKey, { name: string; type: string }>;
  hero: { name: string; seoTitle: string; desc: [string, string]; tags: string[] };
  bands: {
    import: { step: string; headline: string; accent: string };
    optimize: { step: string; headline: string; accent: string };
  };
  carousel: {
    hookKicker: string;
    hookTitle: string;
    seoKicker: string;
    seoTitle: string;
    photoKicker: string;
    photoTitle: string;
    before: string;
    after: string;
    importKicker: string;
    importTitle: string;
    ctaTitle: string;
    ctaButton: string;
    ctaSub: string;
  };
};

export const I18N: Record<Locale, Copy> = {
  en: {
    intro: { title1: "Your catalog.", title2: "Optimized by AI.", anyStore: "+ your own store" },
    import: {
      eyebrow: "Catalog imported",
      heading: "4 products ready to optimize",
      issues: "Issues: SEO · images",
      optimize: "Optimize →",
      toast: "Shopify connected · 128 products synced",
    },
    optimize: {
      visual: "Product visual",
      eyebrow: "AI suggestions",
      source: "Source",
      ai: "AI",
      generateAll: "Generate all",
      generating: "Generating…",
      regenerateAll: "Regenerate all",
      titleLabel: "New SEO title",
      emptyTitle: "(no AI version yet — click Generate)",
      descLabel: "Rewritten description",
      tagsLabel: "Suggested tags",
      imagesLabel: "3 generated images",
      angles: { studio: "Studio", lifestyle: "Lifestyle", inuse: "In use" },
      score: (n) => `Score ${n}`,
    },
    cta: {
      head1: "Optimize your entire catalog",
      head2: "in just a few clicks.",
      button: "Try OneShopLab for free",
      url: "oneshoplab.com · 150 free credits on sign-up",
    },
    credits: (n) => `${n} credits`,
    products: {
      sneaker: { name: "Premium streetwear sneakers", type: "Footwear" },
      watch: { name: "Skeleton automatic watch", type: "Watches" },
      headphones: { name: "Wireless over-ear headphones", type: "Audio" },
      sunglasses: { name: "Polarized sunglasses", type: "Accessories" },
    },
    hero: {
      name: "Premium streetwear sneakers",
      seoTitle: "Premium Leather High-Top Sneakers — Comfort Sole, Unisex | Limited Edition",
      desc: [
        "Minimalist high-top sneakers crafted in premium nappa leather on an ergonomic sole built for all-day comfort.",
        "Unisex fit, hand-stitched finish and a breathable lining — the pair that goes with everything.",
      ],
      tags: ["sneakers", "streetwear", "nappa leather", "unisex", "comfort sole", "limited edition"],
    },
    bands: {
      import: { step: "Step 1 · Import", headline: "Your catalog,", accent: "synced." },
      optimize: { step: "Step 2 · AI optimization", headline: "Pro SEO + visuals,", accent: "in one click." },
    },
    carousel: {
      hookKicker: "The problem",
      hookTitle: "Tired of spending hours on your product listings?",
      seoKicker: "AI copywriting",
      seoTitle: "Generate unique SEO descriptions in one click.",
      photoKicker: "Product photos",
      photoTitle: "Upgrade your product photos instantly.",
      before: "Before",
      after: "After",
      importKicker: "Integration",
      importTitle: "Import your entire store catalog in 2 minutes.",
      ctaTitle: "Free trial, no credit card required.",
      ctaButton: "Try it free",
      ctaSub: "150 free credits on sign-up",
    },
  },

  fr: {
    intro: { title1: "Votre catalogue.", title2: "Optimisé par l'IA.", anyStore: "+ votre boutique" },
    import: {
      eyebrow: "Catalogue importé",
      heading: "4 produits prêts à être optimisés",
      issues: "Problèmes : SEO · images",
      optimize: "Optimiser →",
      toast: "Shopify connecté · 128 produits synchronisés",
    },
    optimize: {
      visual: "Visuel produit",
      eyebrow: "Suggestions IA",
      source: "Source",
      ai: "IA",
      generateAll: "Tout générer",
      generating: "Génération en cours…",
      regenerateAll: "Régénérer tout",
      titleLabel: "Nouveau titre SEO",
      emptyTitle: "(aucune version IA — cliquez sur Générer)",
      descLabel: "Description réécrite",
      tagsLabel: "Tags suggérés",
      imagesLabel: "3 images générées",
      angles: { studio: "Studio", lifestyle: "Lifestyle", inuse: "En usage" },
      score: (n) => `Score ${n}`,
    },
    cta: {
      head1: "Optimisez tout votre catalogue",
      head2: "en quelques clics.",
      button: "Essayez OneShopLab gratuitement",
      url: "oneshoplab.com · 150 crédits offerts à l'inscription",
    },
    credits: (n) => `${n} crédits`,
    products: {
      sneaker: { name: "Baskets streetwear premium", type: "Chaussures" },
      watch: { name: "Montre automatique squelette", type: "Montres" },
      headphones: { name: "Casque audio sans-fil", type: "Audio" },
      sunglasses: { name: "Lunettes de soleil polarisées", type: "Accessoires" },
    },
    hero: {
      name: "Baskets streetwear premium",
      seoTitle: "Baskets Montantes en Cuir Premium — Semelle Confort, Unisexe | Édition Limitée",
      desc: [
        "Des baskets montantes au design épuré en cuir nappa premium, sur une semelle ergonomique pensée pour un confort toute la journée.",
        "Coupe unisexe, finitions cousues main et doublure respirante — la paire qui s'accorde avec tout.",
      ],
      tags: ["baskets", "streetwear", "cuir nappa", "unisexe", "semelle confort", "édition limitée"],
    },
    bands: {
      import: { step: "Étape 1 · Import", headline: "Votre catalogue,", accent: "synchronisé." },
      optimize: { step: "Étape 2 · Optimisation IA", headline: "SEO + visuels pros,", accent: "en 1 clic." },
    },
    carousel: {
      hookKicker: "Le problème",
      hookTitle: "Marre de passer des heures sur vos fiches produits ?",
      seoKicker: "Rédaction IA",
      seoTitle: "Générez des descriptions SEO uniques en 1 clic.",
      photoKicker: "Photos produits",
      photoTitle: "Sublimez vos photos produits instantanément.",
      before: "Avant",
      after: "Après",
      importKicker: "Intégration",
      importTitle: "Importez tout votre catalogue en 2 minutes.",
      ctaTitle: "Essai gratuit, sans carte bancaire.",
      ctaButton: "Tester gratuitement",
      ctaSub: "150 crédits offerts à l'inscription",
    },
  },

  es: {
    intro: { title1: "Tu catálogo.", title2: "Optimizado por IA.", anyStore: "+ tu propia tienda" },
    import: {
      eyebrow: "Catálogo importado",
      heading: "4 productos listos para optimizar",
      issues: "Problemas: SEO · imágenes",
      optimize: "Optimizar →",
      toast: "Shopify conectado · 128 productos sincronizados",
    },
    optimize: {
      visual: "Imagen del producto",
      eyebrow: "Sugerencias IA",
      source: "Original",
      ai: "IA",
      generateAll: "Generar todo",
      generating: "Generando…",
      regenerateAll: "Regenerar todo",
      titleLabel: "Nuevo título SEO",
      emptyTitle: "(sin versión IA todavía — pulsa Generar)",
      descLabel: "Descripción reescrita",
      tagsLabel: "Etiquetas sugeridas",
      imagesLabel: "3 imágenes generadas",
      angles: { studio: "Estudio", lifestyle: "Lifestyle", inuse: "En uso" },
      score: (n) => `Puntuación ${n}`,
    },
    cta: {
      head1: "Optimiza todo tu catálogo",
      head2: "en unos pocos clics.",
      button: "Prueba OneShopLab gratis",
      url: "oneshoplab.com · 150 créditos gratis al registrarte",
    },
    credits: (n) => `${n} créditos`,
    products: {
      sneaker: { name: "Zapatillas streetwear premium", type: "Calzado" },
      watch: { name: "Reloj automático esqueleto", type: "Relojes" },
      headphones: { name: "Auriculares inalámbricos", type: "Audio" },
      sunglasses: { name: "Gafas de sol polarizadas", type: "Accesorios" },
    },
    hero: {
      name: "Zapatillas streetwear premium",
      seoTitle: "Zapatillas Altas de Piel Premium — Suela Confort, Unisex | Edición Limitada",
      desc: [
        "Zapatillas altas de diseño minimalista en piel napa premium, sobre una suela ergonómica pensada para la comodidad todo el día.",
        "Corte unisex, acabados cosidos a mano y forro transpirable: el par que combina con todo.",
      ],
      tags: ["zapatillas", "streetwear", "piel napa", "unisex", "suela confort", "edición limitada"],
    },
    bands: {
      import: { step: "Paso 1 · Importación", headline: "Tu catálogo,", accent: "sincronizado." },
      optimize: { step: "Paso 2 · Optimización IA", headline: "SEO + visuales pro,", accent: "en 1 clic." },
    },
    carousel: {
      hookKicker: "El problema",
      hookTitle: "¿Cansado de pasar horas en tus fichas de producto?",
      seoKicker: "Redacción IA",
      seoTitle: "Genera descripciones SEO únicas en 1 clic.",
      photoKicker: "Fotos de producto",
      photoTitle: "Mejora tus fotos de producto al instante.",
      before: "Antes",
      after: "Después",
      importKicker: "Integración",
      importTitle: "Importa todo tu catálogo en 2 minutos.",
      ctaTitle: "Prueba gratis, sin tarjeta.",
      ctaButton: "Probar gratis",
      ctaSub: "150 créditos gratis al registrarte",
    },
  },

  de: {
    intro: { title1: "Dein Katalog.", title2: "Optimiert per KI.", anyStore: "+ dein eigener Shop" },
    import: {
      eyebrow: "Katalog importiert",
      heading: "4 Produkte bereit zur Optimierung",
      issues: "Probleme: SEO · Bilder",
      optimize: "Optimieren →",
      toast: "Shopify verbunden · 128 Produkte synchronisiert",
    },
    optimize: {
      visual: "Produktbild",
      eyebrow: "KI-Vorschläge",
      source: "Quelle",
      ai: "KI",
      generateAll: "Alles generieren",
      generating: "Wird generiert…",
      regenerateAll: "Alles neu generieren",
      titleLabel: "Neuer SEO-Titel",
      emptyTitle: "(noch keine KI-Version — auf Generieren klicken)",
      descLabel: "Neu geschriebene Beschreibung",
      tagsLabel: "Vorgeschlagene Tags",
      imagesLabel: "3 generierte Bilder",
      angles: { studio: "Studio", lifestyle: "Lifestyle", inuse: "Im Einsatz" },
      score: (n) => `Score ${n}`,
    },
    cta: {
      head1: "Optimiere deinen ganzen Katalog",
      head2: "in wenigen Klicks.",
      button: "OneShopLab kostenlos testen",
      url: "oneshoplab.com · 150 Gratis-Credits bei Anmeldung",
    },
    credits: (n) => `${n} Credits`,
    products: {
      sneaker: { name: "Premium Streetwear-Sneaker", type: "Schuhe" },
      watch: { name: "Automatik-Skelettuhr", type: "Uhren" },
      headphones: { name: "Kabellose Over-Ear-Kopfhörer", type: "Audio" },
      sunglasses: { name: "Polarisierte Sonnenbrille", type: "Accessoires" },
    },
    hero: {
      name: "Premium Streetwear-Sneaker",
      seoTitle: "Hohe Sneaker aus Premium-Leder — Komfortsohle, Unisex | Limited Edition",
      desc: [
        "Minimalistische High-Top-Sneaker aus hochwertigem Nappaleder auf einer ergonomischen Sohle für ganztägigen Komfort.",
        "Unisex-Passform, handvernähte Verarbeitung und atmungsaktives Futter – das Paar, das zu allem passt.",
      ],
      tags: ["sneaker", "streetwear", "nappaleder", "unisex", "komfortsohle", "limited edition"],
    },
    bands: {
      import: { step: "Schritt 1 · Import", headline: "Dein Katalog,", accent: "synchronisiert." },
      optimize: { step: "Schritt 2 · KI-Optimierung", headline: "Pro-SEO + Bilder,", accent: "in 1 Klick." },
    },
    carousel: {
      hookKicker: "Das Problem",
      hookTitle: "Keine Lust mehr auf stundenlange Produkttexte?",
      seoKicker: "KI-Texte",
      seoTitle: "Erstelle einzigartige SEO-Beschreibungen mit 1 Klick.",
      photoKicker: "Produktfotos",
      photoTitle: "Verfeinere deine Produktfotos im Nu.",
      before: "Vorher",
      after: "Nachher",
      importKicker: "Integration",
      importTitle: "Importiere deinen ganzen Katalog in 2 Minuten.",
      ctaTitle: "Kostenlos testen, ohne Kreditkarte.",
      ctaButton: "Kostenlos testen",
      ctaSub: "150 Gratis-Credits bei Anmeldung",
    },
  },

  it: {
    intro: { title1: "Il tuo catalogo.", title2: "Ottimizzato dall'IA.", anyStore: "+ il tuo negozio" },
    import: {
      eyebrow: "Catalogo importato",
      heading: "4 prodotti pronti da ottimizzare",
      issues: "Problemi: SEO · immagini",
      optimize: "Ottimizza →",
      toast: "Shopify connesso · 128 prodotti sincronizzati",
    },
    optimize: {
      visual: "Immagine prodotto",
      eyebrow: "Suggerimenti IA",
      source: "Origine",
      ai: "IA",
      generateAll: "Genera tutto",
      generating: "Generazione…",
      regenerateAll: "Rigenera tutto",
      titleLabel: "Nuovo titolo SEO",
      emptyTitle: "(nessuna versione IA — clicca su Genera)",
      descLabel: "Descrizione riscritta",
      tagsLabel: "Tag suggeriti",
      imagesLabel: "3 immagini generate",
      angles: { studio: "Studio", lifestyle: "Lifestyle", inuse: "In uso" },
      score: (n) => `Score ${n}`,
    },
    cta: {
      head1: "Ottimizza tutto il tuo catalogo",
      head2: "in pochi clic.",
      button: "Prova OneShopLab gratis",
      url: "oneshoplab.com · 150 crediti omaggio all'iscrizione",
    },
    credits: (n) => `${n} crediti`,
    products: {
      sneaker: { name: "Sneaker streetwear premium", type: "Calzature" },
      watch: { name: "Orologio automatico scheletrato", type: "Orologi" },
      headphones: { name: "Cuffie wireless over-ear", type: "Audio" },
      sunglasses: { name: "Occhiali da sole polarizzati", type: "Accessori" },
    },
    hero: {
      name: "Sneaker streetwear premium",
      seoTitle: "Sneaker Alte in Pelle Premium — Suola Comfort, Unisex | Edizione Limitata",
      desc: [
        "Sneaker alte dal design essenziale in pregiata pelle nappa, su una suola ergonomica pensata per il comfort tutto il giorno.",
        "Vestibilità unisex, finiture cucite a mano e fodera traspirante: il paio che si abbina a tutto.",
      ],
      tags: ["sneaker", "streetwear", "pelle nappa", "unisex", "suola comfort", "edizione limitata"],
    },
    bands: {
      import: { step: "Passo 1 · Import", headline: "Il tuo catalogo,", accent: "sincronizzato." },
      optimize: { step: "Passo 2 · Ottimizzazione IA", headline: "SEO + visual pro,", accent: "in 1 clic." },
    },
    carousel: {
      hookKicker: "Il problema",
      hookTitle: "Stanco di passare ore sulle schede prodotto?",
      seoKicker: "Testi IA",
      seoTitle: "Genera descrizioni SEO uniche in 1 clic.",
      photoKicker: "Foto prodotto",
      photoTitle: "Sublima le tue foto prodotto all'istante.",
      before: "Prima",
      after: "Dopo",
      importKicker: "Integrazione",
      importTitle: "Importa tutto il tuo catalogo in 2 minuti.",
      ctaTitle: "Prova gratis, senza carta.",
      ctaButton: "Prova gratis",
      ctaSub: "150 crediti omaggio all'iscrizione",
    },
  },
};
