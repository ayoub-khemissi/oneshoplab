# Audit infra SEO — état du code vs addendum + manuel Partie 1

> Audit lecture seule du code au 2026-05-18. Croisé avec
> `addendum-seo-multilingue.md` (§6 priorisé) et `manuel-execution-oneshoplab.md`
> (Partie 1). Références = `fichier:ligne`.

## Verdict

La fondation technique multilingue (hreflang réciproque, x-default, canonical
self-référent, sitemap, `html lang/dir`) est **correctement implémentée** sur
les pages marketing existantes — l'addendum §2, le point « que tout le monde
rate », est respecté. **Mais** les deux pages dont dépend toute la prospection
(audit gratuit sans inscription, section blog) **n'existent pas**, et deux
défauts mineurs de canonical sont à corriger.

---

## Tableau d'état

| # | Exigence (addendum §6 / manuel P1) | État | Preuve |
|---|---|---|---|
| 1 | URLs distinctes crawlables par langue | ✅ OK | `i18n/routing.ts:83` `localePrefix:'always'`, 13 locales |
| 2 | hreflang réciproque + x-default + canonical self-référent | ✅ OK (pages existantes) | `app/[locale]/layout.tsx:90-93`, `app/[locale]/page.tsx:44-47`, `pricing/page.tsx:40-43`, `faq` idem |
| 3 | Sitemap multilingue | ⚠️ OK mais incomplet | `app/sitemap.ts` — 5 chemins marketing seulement, ni blog ni audit-gratuit |
| 4 | `html lang` + `dir=rtl` | ✅ OK | `app/[locale]/layout.tsx:149-153` (`dir` via `RTL_LOCALES`, `ar→rtl`) + JSON-LD Organization bonus |
| 5 | GA4 / Search Console segmentés | ✅ **FAIT** (code) | GA4 consent-gated opt-in (`shared/analytics` (`ui/analytics.tsx` + `consent.ts`)), inerte sans `NEXT_PUBLIC_GA_MEASUREMENT_ID` ; politique de confidentialité mise à jour. Reste manuel : propriété GA4 + filtres GSC |
| 6 | **Page d'audit gratuit SANS inscription** | ✅ **FAIT** | `app/[locale]/audit/` (formulaire + résultat), `launchAnonymousAudit` (scrape+score, zéro crédit), entrée sitemap, i18n 13 langues |
| P1.4 | Section blog `/fr/blog` | ✅ **FAIT** | `app/[locale]/blog/` (index + `[slug]`), registre `src/entities/blog/`, hreflang par-article (FR+EN), entrées sitemap dynamiques, article pilote seedé |

---

## Ce qui est bien fait (à ne pas retoucher)

- `localePrefix:'always'` conforme au landmine CLAUDE.md ; chaque langue = URL
  réelle SSR. Le test curl de l'addendum §1 passera (rendu serveur).
- Canonical **self-référent par locale** partout où il existe
  (`${SITE_URL}/${locale}...`), jamais vers `/fr` — l'erreur n°1 de
  l'addendum §2 est évitée.
- Map `languages` régénérée intégralement sur chaque page ⇒ hreflang
  **réciproques** + `x-default → /en`. Exactement le patron prescrit.
- `html lang/dir` + RTL arabe corrects. JSON-LD Organization en bonus.
- `robots.ts` bloque `/share/` à juste titre (liens prospect 1:1, contenu
  client — ne doivent pas être indexés).

---

## Blocages, par ordre de priorité

### 1. ❌ BLOQUANT — Page d'audit gratuit sans inscription (manuel P1.5, addendum §6.6)

`app/[locale]/page.tsx:65-70` : un visiteur anonyme qui lance un audit est
**redirigé vers `/login`**. Il n'existe aucune page `/audit-gratuit`.

Conséquence directe sur la prospection : **tous** les CTA des livrables
(`posts-linkedin-fr.md` premier commentaire, `sequence-prospection-fr.md`)
pointent vers « auditer gratuitement / sans inscription » → aujourd'hui ils
tombent sur un mur de login. Le manuel est explicite : *« Si une seule chose
technique doit être priorisée après le sitemap, c'est celle-ci. »*

À construire : `app/[locale]/audit-gratuit/page.tsx` — saisie d'URL → score
visible **sans compte**, inscription demandée seulement pour générer/aller
plus loin. + `generateMetadata` (patron `pricing/page.tsx:25-43`) + entrée
sitemap. Décliné FR et EN d'abord (addendum §6.6).

### 2. ❌ BLOQUANT pour le contenu — Section blog (manuel P1.4)

Aucune route blog. L'article pilote (`article-pilote-oneshoplab.md`, FR + EN)
n'a nulle part où être publié ; son URL cible `/blog/fiches-produits-ne-convertissent-pas`
renvoie `notFound()` via le catch-all.

À construire : `app/[locale]/blog/[slug]/page.tsx` + index `app/[locale]/blog/page.tsx`,
avec `generateMetadata` hreflang/canonical par article (patron addendum §2) et
**injection dynamique des slugs dans `app/sitemap.ts`** (actuellement la liste
des chemins est statique).

### 3. ✅ RÉSOLU — canonical terms & privacy

`terms/page.tsx` et `privacy/page.tsx` n'ont **pas** de `generateMetadata`
propre → elles héritent du canonical du layout racine, soit
`${SITE_URL}/${locale}` (la **home**), pas `/terms` ni `/privacy`. C'est
précisément l'anti-patron de l'addendum §2 (canonical pointant ailleurs que
soi-même). Enjeu SEO faible (ces pages ne ciblent aucun mot-clé) mais
correction triviale : ajouter le même `generateMetadata` que `pricing`.
`faq` est OK.

### 4. ✅ RÉSOLU (code) — GA4 consent-gated

Aucun tag analytics dans le layout. Sans GA4, la règle de décision de
l'addendum §5 / manuel P6 (« inscriptions par langue/pays », activer une 3ᵉ
langue sur 4–8 sem.) **ne peut pas fonctionner** — tu piloterais à l'aveugle.
Manuel Partie 0 le classe « indispensable ». À installer (GA4 ou équivalent
respectant le cookie-banner déjà présent).

### 5. ℹ️ Note non bloquante — `force-dynamic`

`app/[locale]/layout.tsx:131` `export const dynamic = 'force-dynamic'` : tout
est rendu serveur à chaque hit, pas de SSG/ISR. Sans impact sur la
crawlabilité (le HTML est complet côté serveur) ; juste pas de cache statique.
Acceptable au démarrage, à revoir si le blog prend du volume.

---

## Clarification importante pour les docs de prospection

Deux actifs distincts, à ne pas confondre :

- **`/share/[token]`** (existe, `robots.ts` le bloque) = lien prospect
  **1:1** émis à la main, contenu client. C'est le « before/after » de
  `sequence-prospection-fr.md` — correct et suffisant pour l'outreach direct,
  **non indexable** par design.
- **`/audit-gratuit`** (manquant) = page publique d'acquisition, cible des
  posts LinkedIn et du SEO. C'est l'actif #1 à construire.

Les deux séquences livrées restent valides : la 1:1 fonctionne dès que tu
peux générer des liens `/share`. Les posts LinkedIn, eux, attendent
`/audit-gratuit` pour avoir une destination de premier commentaire.

---

## Ordre d'exécution recommandé (dev)

Tout le code est fait (2026-05-18). Ne restent que des actions **manuelles
hors-code** :

1. ~~`/audit` FR→13 sans login~~ — ✅ FAIT (+ reCAPTCHA câblé, dev-safe).
   Reste : QA manuelle navigateur.
2. ~~Section blog + slugs dynamiques sitemap~~ — ✅ FAIT. Reste : déposer
   les 3 visuels + couverture de l'article pilote (éditorial, manuel P2).
3. ~~GA4 consent-gated~~ — ✅ FAIT (code, **politique de confidentialité
   incluse** : §1.8 Analytics, §1.9 reCAPTCHA, table sous-traitants,
   rétention, bases légales — `privacy/page.tsx`). Reste manuel : créer la
   propriété GA4, poser `NEXT_PUBLIC_GA_MEASUREMENT_ID`, créer les filtres
   Search Console par dossier `/fr/ /en/`.
4. ~~`generateMetadata` canonical `terms` + `privacy`~~ — ✅ FAIT.
5. Soumettre `sitemap.xml` à Search Console (manuel P1.2) — action GSC,
   non automatisable depuis le code.
