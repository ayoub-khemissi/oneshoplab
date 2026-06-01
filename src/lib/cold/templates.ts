/**
 * Cold-outreach templates. v1 covers touch 1 (J+0) in FR + EN, across
 * three variants picked from lead.platform + whether a pre-run audit
 * is available:
 *
 *   - 'agency'              → lead.platform = 'unknown' (directory-only
 *                             contact, typically an agency or
 *                             freelancer).
 *   - 'merchant_audited'    → shopify/woo/wix lead AND a recent anon
 *                             audit exists for the domain. Body opens
 *                             with "your report is ready" framing.
 *   - 'merchant_unaudited'  → shopify/woo/wix lead with no audit yet.
 *                             Body opens generic, CTA = "Audit my
 *                             catalog".
 *
 * Tone is product-first (what OneShopLab does) — not "I'd love to walk
 * you through it". Discord is positioned as the place to chat with the
 * builder, follow product updates, and surface bugs/feature requests
 * (not a sales-call channel). discordUrl is sourced from
 * NEXT_PUBLIC_DISCORD_INVITE_URL.
 */

export type ColdLang = 'fr' | 'en';
export type ColdTouch = 1; // | 2 | 3 | 4 — added incrementally
export type ColdVariant = 'agency' | 'merchant_audited' | 'merchant_unaudited';

interface Template {
  subject: string;
  /** Plain text — used both as the text/plain part AND as the source the
   *  HTML version is derived from (paragraph-per-blank-line). */
  body: string;
}

const FR_AGENCY_T1: Template = {
  subject: 'OneShopLab — audit et génération assistée pour vos clients e-commerce',
  body: `Bonjour {firstName},

Je vous écris parce que vous accompagnez des clients e-commerce chez {agencyName}. Je viens de sortir OneShopLab, je pense que ça peut intéresser votre équipe.

Ce que fait l'outil sur catalogues Shopify, WooCommerce et Wix :

- Audit catalogue automatique en 2 minutes depuis l'URL — score SEO produits, qualité visuelle, complétude des fiches, et liste des fiches sous-optimisées qui dégradent la conversion.
- Génération assistée par IA en lot : titres, descriptions, tags, visuels produits — selon vos consignes, rendu cohérent sur toute la collection.
- Tableau de bord par site avec suivi des modifications et synchronisation des produits ajoutés, supprimés ou édités.

Côté usage agence, ça sert deux choses concrètes :
1. Diagnostic gratuit illimité pour qualifier un prospect avant un rendez-vous commercial.
2. Production déléguée à l'outil sur vos clients existants — vous gardez la marge agence, l'outil absorbe la charge de génération.

L'audit est gratuit et sans inscription :

[[CTA Lancer l'audit gratuit | {auditUrl}]]

Le Discord est ouvert si vous voulez échanger avec moi (je développe l'outil seul), rejoindre la communauté qui se monte autour du produit, ou remonter des bugs, des manques ou des suggestions de fonctionnalités.

[[DISCORD Rejoindre le Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
Vous recevez ce message car votre activité (agence e-commerce) correspond à un usage professionnel de notre outil. Conformément au RGPD (intérêt légitime — art. 6.1.f), vous pouvez vous opposer à ce traitement en répondant "stop" à ce mail ou via [[LINK ce lien | {optOutUrl}]]. Source : recherche publique (votre site agence et portfolio).`
};

const EN_AGENCY_T1: Template = {
  subject: 'OneShopLab — audit & assisted generation for your e-com clients',
  body: `Hi {firstName},

I'm reaching out because you support e-commerce clients at {agencyName}. I just shipped OneShopLab and I think it could be a fit for your team.

What the tool does on Shopify, WooCommerce and Wix catalogs:

- Automated catalog audit in 2 minutes from a URL — product SEO score, visual quality, listing completeness, and a list of underperforming products that drag conversion.
- Bulk AI-assisted generation: titles, descriptions, tags, packshots — to your brief, consistent output across the whole collection.
- Per-site dashboard with change tracking and product sync (added / removed / edited).

For an agency, the practical use cases are:
1. Free unlimited diagnostic to qualify a prospect before a sales call.
2. Production delegated to the tool on existing clients — you keep the agency margin, the tool absorbs the generation workload.

The audit is free and requires no signup:

[[CTA Run the free audit | {auditUrl}]]

The Discord is open if you want to chat with me (I'm building this solo), join the community forming around the tool, or report bugs, gaps and feature requests.

[[DISCORD Join the Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
You're receiving this email because your activity (e-commerce agency) matches a professional use of our tool. Under GDPR (legitimate interest — art. 6.1.f), you can object to this processing by replying "stop" or via [[LINK this link | {optOutUrl}]]. Source: public research (your agency site and portfolio).`
};

const FR_MERCHANT_AUDITED_T1: Template = {
  subject: 'Audit de {storeName} — votre rapport est prêt',
  body: `Bonjour {firstName},

J'ai lancé un audit catalogue automatisé sur votre boutique {storeName} ({platformDisplay}). Voici le verdict :

[[SCORES]]

Sur {productsAudited} produits analysés : {productsNoImage} sans image, {productsNoDesc} sans description, {productsNoTags} sans tags.

Le rapport détaillé liste les fiches les plus sous-optimisées avec leurs problèmes ciblés, la répartition complète des manques sur le catalogue, et les axes prioritaires à traiter en premier. Consultable directement, sans connexion :

[[CTA Voir mon rapport d'audit | {auditUrl}]]

Ce que fait OneShopLab au-delà de l'audit :

- Génération assistée par IA en lot : titres, descriptions, tags, visuels produits — selon vos consignes, rendu cohérent sur toute la collection {platformDisplay}.
- Tableau de bord par site avec suivi des modifications et synchronisation des produits ajoutés, supprimés ou édités.
- Tarification au crédit, sans abonnement obligatoire, pour maîtriser vos coûts.

Le Discord est ouvert si vous voulez échanger avec moi (je développe l'outil seul), suivre l'évolution du produit, ou remonter des bugs ou des manques sur votre cas.

[[DISCORD Rejoindre le Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
Vous recevez ce message car votre boutique e-commerce correspond à un usage professionnel de notre outil. Conformément au RGPD (intérêt légitime — art. 6.1.f), vous pouvez vous opposer à ce traitement en répondant "stop" à ce mail ou via [[LINK ce lien | {optOutUrl}]]. Source : recherche publique (annuaires e-commerce + Google).`
};

const EN_MERCHANT_AUDITED_T1: Template = {
  subject: 'Audit of {storeName} — your report is ready',
  body: `Hi {firstName},

I ran an automated catalog audit on your store {storeName} ({platformDisplay}). Here's the verdict:

[[SCORES]]

Across {productsAudited} products analyzed: {productsNoImage} without images, {productsNoDesc} without descriptions, {productsNoTags} without tags.

The full report lists the top underperforming listings with targeted issues, the complete distribution of gaps across the catalog, and the priority axes to fix first. Available directly, no login:

[[CTA See my audit report | {auditUrl}]]

What OneShopLab does beyond the audit:

- Bulk AI-assisted generation: titles, descriptions, tags, packshots — to your brief, consistent output across the whole {platformDisplay} collection.
- Per-site dashboard with change tracking and product sync (added / removed / edited).
- Credit-based pricing, no mandatory subscription — you stay in control of the cost.

The Discord is open if you want to chat with me (I'm building this solo), follow product updates, or report bugs or gaps on your use case.

[[DISCORD Join the Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
You're receiving this email because your e-commerce store matches a professional use of our tool. Under GDPR (legitimate interest — art. 6.1.f), you can object to this processing by replying "stop" or via [[LINK this link | {optOutUrl}]]. Source: public research (e-commerce directories + Google).`
};

const FR_MERCHANT_UNAUDITED_T1: Template = {
  subject: 'Audit catalogue gratuit pour {storeName}',
  body: `Bonjour {firstName},

Je suis tombé sur votre boutique {storeName} ({platformDisplay}) en explorant des catalogues e-commerce, et je voulais vous présenter OneShopLab.

Ce que fait l'outil sur catalogues {platformDisplay} :

- Audit catalogue automatique en 2 minutes depuis l'URL — score SEO produits, qualité visuelle, complétude des fiches, et les fiches les plus sous-optimisées avec leurs problèmes détaillés.
- Génération assistée par IA en lot : titres, descriptions, tags, visuels produits — selon vos consignes, rendu cohérent sur toute la collection.
- Tableau de bord par site avec suivi des modifications et synchronisation des produits ajoutés, supprimés ou édités.
- Tarification au crédit, sans abonnement obligatoire.

L'audit est gratuit, sans inscription et sans engagement :

[[CTA Auditer mon catalogue | {auditUrl}]]

Le Discord est ouvert si vous voulez échanger avec moi (je développe l'outil seul), suivre les évolutions du produit, ou remonter des bugs ou des manques sur votre cas.

[[DISCORD Rejoindre le Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
Vous recevez ce message car votre boutique e-commerce correspond à un usage professionnel de notre outil. Conformément au RGPD (intérêt légitime — art. 6.1.f), vous pouvez vous opposer à ce traitement en répondant "stop" à ce mail ou via [[LINK ce lien | {optOutUrl}]]. Source : recherche publique (annuaires e-commerce + Google).`
};

const EN_MERCHANT_UNAUDITED_T1: Template = {
  subject: 'Free catalog audit for {storeName}',
  body: `Hi {firstName},

I came across your store {storeName} ({platformDisplay}) while exploring e-commerce catalogs, and I wanted to share OneShopLab.

What the tool does on {platformDisplay} catalogs:

- Automated catalog audit in 2 minutes from a URL — product SEO score, visual quality, listing completeness, top underperforming listings with detailed issues.
- Bulk AI-assisted generation: titles, descriptions, tags, packshots — to your brief, consistent output across the whole collection.
- Per-site dashboard with change tracking and product sync (added / removed / edited).
- Credit-based pricing, no mandatory subscription.

The audit is free, no signup, no commitment:

[[CTA Audit my catalog | {auditUrl}]]

The Discord is open if you want to chat with me (I'm building this solo), follow product updates, or report bugs or gaps on your use case.

[[DISCORD Join the Discord | {discordUrl}]]

— {fromName}
OneShopLab

—
You're receiving this email because your e-commerce store matches a professional use of our tool. Under GDPR (legitimate interest — art. 6.1.f), you can object to this processing by replying "stop" or via [[LINK this link | {optOutUrl}]]. Source: public research (e-commerce directories + Google).`
};

const TEMPLATES: Record<ColdVariant, Record<ColdLang, Record<ColdTouch, Template>>> = {
  agency: {
    fr: { 1: FR_AGENCY_T1 },
    en: { 1: EN_AGENCY_T1 }
  },
  merchant_audited: {
    fr: { 1: FR_MERCHANT_AUDITED_T1 },
    en: { 1: EN_MERCHANT_AUDITED_T1 }
  },
  merchant_unaudited: {
    fr: { 1: FR_MERCHANT_UNAUDITED_T1 },
    en: { 1: EN_MERCHANT_UNAUDITED_T1 }
  }
};

export function getTemplate(
  variant: ColdVariant,
  lang: ColdLang,
  touch: ColdTouch
): Template {
  const t = TEMPLATES[variant]?.[lang]?.[touch];
  if (!t) throw new Error(`No template for variant=${variant} lang=${lang} touch=${touch}`);
  return t;
}

/** Variables expected by the AGENCY template. */
export interface AgencyColdVars {
  firstName: string;
  agencyName: string;
  auditUrl: string;
  discordUrl: string;
  optOutUrl: string;
  fromName: string;
}

/** Variables expected by both MERCHANT templates (audited + unaudited).
 *  The stat fields (productsAudited, productsNoImage, productsNoDesc,
 *  productsNoTags) are only referenced by the merchant_audited body;
 *  the unaudited body ignores them. The cold script always supplies
 *  them anyway ("0" for unaudited) so the substitute() helper never
 *  trips over a missing key. */
export interface MerchantColdVars {
  firstName: string;
  storeName: string;
  /** Pretty platform name shown in the body — "Shopify", "WooCommerce",
   *  "Wix". Derived from lead.platform by the caller. */
  platformDisplay: string;
  /** /audit/{token} for merchant_audited, homepage for unaudited. */
  auditUrl: string;
  discordUrl: string;
  optOutUrl: string;
  fromName: string;
  /** Pre-rendered stat strings for merchant_audited's hook line. */
  productsAudited: string;
  productsNoImage: string;
  productsNoDesc: string;
  productsNoTags: string;
}

export type ColdVars = AgencyColdVars | MerchantColdVars;

/** Human-readable platform label used inside the merchant templates. */
export function platformDisplayName(platform: string): string {
  switch (platform) {
    case 'shopify':
      return 'Shopify';
    case 'woocommerce':
      return 'WooCommerce';
    case 'wix':
      return 'Wix';
    default:
      return platform;
  }
}
