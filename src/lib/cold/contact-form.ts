/**
 * Ready-to-paste copy for MANUAL outreach via a prospect's contact
 * form (or contact email when there's no scrapeable address). Distinct
 * from the email templates in templates.ts:
 *
 *   - No opt-out link — you can't unsubscribe someone from a one-off
 *     contact-form submission, and a form rarely lets you embed a
 *     working link anyway. The RGPD opt-out obligation is satisfied by
 *     the message being a direct, identified, professional approach
 *     the recipient initiated the channel for.
 *   - Plain text only (forms strip HTML) — no [[CTA]] / [[DISCORD]]
 *     markers, just inline URLs.
 *   - Punchier, shorter — a form reader skims; the score / the word
 *     "gratuit/free" carries the hook in the first line.
 *
 * Four languages (fr / en / it / es — the top by lead.language in the
 * CRM) × three variants (agency / merchant_audited /
 * merchant_unaudited), mirroring the email variant split.
 */

export type ContactLang = 'fr' | 'en' | 'it' | 'es';
export const CONTACT_LANGS: readonly ContactLang[] = ['fr', 'en', 'it', 'es'] as const;

export type ContactVariant = 'agency' | 'merchant_audited' | 'merchant_unaudited';

export interface ContactCopy {
  subject: string;
  body: string;
}

export interface ContactVars {
  /** Store name (merchant) or agency name. Derived from the domain. */
  name: string;
  /** "Shopify" | "WooCommerce" | … — only used by merchant variants. */
  platformDisplay: string;
  /** /audit/{token} (audited) or the site root (unaudited / agency). */
  auditUrl: string;
  /** Public Discord invite. */
  discordUrl: string;
  /** Overall audit score ("67") — merchant_audited subject + body. */
  scoreOverall: string;
  /** Sender display name. */
  fromName: string;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`Missing contact-copy var: ${k}`);
    return v;
  });
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

const TEMPLATES: Record<ContactVariant, Record<ContactLang, ContactCopy>> = {
  merchant_audited: {
    fr: {
      subject: 'Audit de {name} : {scoreOverall}/100 (rapport gratuit)',
      body: `Bonjour,

J'ai lancé un audit automatisé du catalogue de {name} ({platformDisplay}) : score global {scoreOverall}/100.

Le rapport détaillé est consultable gratuitement, sans inscription — SEO produits, qualité visuelle, complétude des fiches, et les fiches les plus à optimiser :
{auditUrl}

OneShopLab génère aussi en lot les titres, descriptions, tags et visuels produits manquants, utile pour corriger ce que l'audit remonte.

Si le sujet vous intéresse, je suis joignable en réponse à ce message ou sur Discord : {discordUrl}

Bonne journée,
{fromName} — OneShopLab`
    },
    en: {
      subject: 'Audit of {name}: {scoreOverall}/100 (free report)',
      body: `Hi,

I ran an automated audit of {name}'s catalog ({platformDisplay}): overall score {scoreOverall}/100.

The full report is free to view, no signup — product SEO, visual quality, listing completeness, and the listings most worth optimizing:
{auditUrl}

OneShopLab also bulk-generates the missing titles, descriptions, tags and product visuals, handy for fixing what the audit surfaces.

If it's of interest, I'm reachable by replying here or on Discord: {discordUrl}

Best,
{fromName} — OneShopLab`
    },
    it: {
      subject: 'Audit di {name}: {scoreOverall}/100 (report gratuito)',
      body: `Buongiorno,

Ho effettuato un audit automatico del catalogo di {name} ({platformDisplay}): punteggio complessivo {scoreOverall}/100.

Il report dettagliato è consultabile gratuitamente, senza registrazione — SEO prodotti, qualità visiva, completezza delle schede e le schede più da ottimizzare:
{auditUrl}

OneShopLab genera anche in blocco titoli, descrizioni, tag e immagini prodotto mancanti, utile per correggere ciò che l'audit evidenzia.

Se l'argomento le interessa, sono raggiungibile rispondendo a questo messaggio o su Discord: {discordUrl}

Buona giornata,
{fromName} — OneShopLab`
    },
    es: {
      subject: 'Auditoría de {name}: {scoreOverall}/100 (informe gratuito)',
      body: `Hola,

He realizado una auditoría automática del catálogo de {name} ({platformDisplay}): puntuación global {scoreOverall}/100.

El informe detallado se puede consultar gratis, sin registro — SEO de productos, calidad visual, completitud de las fichas y las fichas más a optimizar:
{auditUrl}

OneShopLab también genera en lote los títulos, descripciones, etiquetas y visuales de producto que faltan, útil para corregir lo que la auditoría señala.

Si le interesa, estoy disponible respondiendo a este mensaje o en Discord: {discordUrl}

Un saludo,
{fromName} — OneShopLab`
    }
  },
  merchant_unaudited: {
    fr: {
      subject: 'Audit catalogue gratuit pour {name}',
      body: `Bonjour,

Je me permets de vous contacter au sujet du catalogue de {name}.

OneShopLab audite gratuitement votre catalogue {platformDisplay} en 2 minutes — SEO produits, qualité des photos, complétude des fiches — et génère en lot les contenus manquants : titres, descriptions, tags, visuels produits.

Vous pouvez lancer l'audit ici, sans inscription :
{auditUrl}

Si ça vous parle, je suis joignable en réponse à ce message ou sur Discord : {discordUrl}

Bonne journée,
{fromName} — OneShopLab`
    },
    en: {
      subject: 'Free catalog audit for {name}',
      body: `Hi,

I'm reaching out about {name}'s catalog.

OneShopLab audits your {platformDisplay} catalog for free in 2 minutes — product SEO, image quality, listing completeness — and bulk-generates the missing content: titles, descriptions, tags, product visuals.

You can run the audit here, no signup:
{auditUrl}

If it resonates, I'm reachable by replying here or on Discord: {discordUrl}

Best,
{fromName} — OneShopLab`
    },
    it: {
      subject: 'Audit del catalogo gratuito per {name}',
      body: `Buongiorno,

Le scrivo a proposito del catalogo di {name}.

OneShopLab analizza gratuitamente il suo catalogo {platformDisplay} in 2 minuti — SEO prodotti, qualità delle foto, completezza delle schede — e genera in blocco i contenuti mancanti: titoli, descrizioni, tag, immagini prodotto.

Può avviare l'audit qui, senza registrazione:
{auditUrl}

Se le interessa, sono raggiungibile rispondendo a questo messaggio o su Discord: {discordUrl}

Buona giornata,
{fromName} — OneShopLab`
    },
    es: {
      subject: 'Auditoría de catálogo gratuita para {name}',
      body: `Hola,

Me pongo en contacto con usted sobre el catálogo de {name}.

OneShopLab audita gratis su catálogo {platformDisplay} en 2 minutos — SEO de productos, calidad de las fotos, completitud de las fichas — y genera en lote el contenido que falta: títulos, descripciones, etiquetas, visuales de producto.

Puede lanzar la auditoría aquí, sin registro:
{auditUrl}

Si le interesa, estoy disponible respondiendo a este mensaje o en Discord: {discordUrl}

Un saludo,
{fromName} — OneShopLab`
    }
  },
  agency: {
    fr: {
      subject: "Un outil d'audit + génération pour les clients de {name}",
      body: `Bonjour,

Je vous contacte car {name} accompagne des clients e-commerce.

OneShopLab audite gratuitement un catalogue Shopify, WooCommerce ou Wix et génère en lot les contenus produits — titres, descriptions, tags, visuels IA. Côté agence, ça sert à qualifier un prospect avant un rendez-vous commercial, ou à déléguer la production de contenu sur vos clients existants en gardant votre marge.

L'essai est ouvert ici, sans inscription :
{auditUrl}

Je suis joignable en réponse à ce message ou sur Discord : {discordUrl}

Bonne journée,
{fromName} — OneShopLab`
    },
    en: {
      subject: 'An audit + generation tool for {name}\'s clients',
      body: `Hi,

I'm reaching out because {name} supports e-commerce clients.

OneShopLab audits a Shopify, WooCommerce or Wix catalog for free and bulk-generates product content — titles, descriptions, tags, AI visuals. For an agency, it's useful to qualify a prospect before a sales call, or to delegate content production on existing clients while keeping your margin.

The trial is open here, no signup:
{auditUrl}

I'm reachable by replying here or on Discord: {discordUrl}

Best,
{fromName} — OneShopLab`
    },
    it: {
      subject: 'Uno strumento di audit + generazione per i clienti di {name}',
      body: `Buongiorno,

Le scrivo perché {name} segue clienti e-commerce.

OneShopLab analizza gratuitamente un catalogo Shopify, WooCommerce o Wix e genera in blocco i contenuti prodotto — titoli, descrizioni, tag, immagini IA. Per un'agenzia è utile per qualificare un prospect prima di un incontro commerciale, o per delegare la produzione di contenuti sui clienti esistenti mantenendo il proprio margine.

La prova è aperta qui, senza registrazione:
{auditUrl}

Sono raggiungibile rispondendo a questo messaggio o su Discord: {discordUrl}

Buona giornata,
{fromName} — OneShopLab`
    },
    es: {
      subject: 'Una herramienta de auditoría + generación para los clientes de {name}',
      body: `Hola,

Le escribo porque {name} acompaña a clientes de e-commerce.

OneShopLab audita gratis un catálogo Shopify, WooCommerce o Wix y genera en lote el contenido de producto — títulos, descripciones, etiquetas, visuales con IA. Para una agencia, es útil para cualificar a un prospecto antes de una reunión comercial, o para delegar la producción de contenido en sus clientes actuales manteniendo su margen.

La prueba está abierta aquí, sin registro:
{auditUrl}

Estoy disponible respondiendo a este mensaje o en Discord: {discordUrl}

Un saludo,
{fromName} — OneShopLab`
    }
  }
};

export function buildContactCopy(
  variant: ContactVariant,
  lang: ContactLang,
  vars: ContactVars
): ContactCopy {
  const tpl = TEMPLATES[variant][lang];
  const dict = vars as unknown as Record<string, string>;
  return {
    subject: substitute(tpl.subject, dict),
    body: substitute(tpl.body, dict)
  };
}

/** Map a lead's stored language to one of our supported copy languages,
 *  defaulting to English for anything else (incl. NULL). */
export function pickContactLang(language: string | null | undefined): ContactLang {
  if (language === 'fr') return 'fr';
  if (language === 'it') return 'it';
  if (language === 'es') return 'es';
  return 'en';
}
