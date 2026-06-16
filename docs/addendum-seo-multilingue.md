# Addendum technique — SEO multilingue (à intégrer au manuel d'exécution)

Vous êtes dév : ce document va droit au but, avec le code. À lire en complément du manuel principal.
Stratégie verrouillée : **interface 13 langues, contenu 2 langues (FR puis EN)**, infrastructure technique prête pour les 13.

---

## Principe directeur

Largeur technique maximale, profondeur éditoriale étroite. Vous implémentez l'infra hreflang/sitemap/canonical pour **toutes** les langues même si vous n'écrivez qu'en FR et EN. Raison : dès qu'une page existe en 13 versions, Google DOIT comprendre leur relation, sinon il les traite comme du contenu dupliqué et peut servir la mauvaise langue au mauvais visiteur. L'infra n'est pas optionnelle ; le contenu, lui, est ciblé.

---

## 1. URLs distinctes et crawlables (vérification)

Non négociable : chaque langue = une URL réelle, servie en SSR/SSG, accessible sans JS ni cookie.

- ✅ Bon : `oneshoplab.com/fr/blog/x`, `oneshoplab.com/en/blog/x`
- ❌ Mauvais : langue changée par cookie ou `Accept-Language` sans changement d'URL → Google ne voit qu'une version.

Vous avez déjà le préfixe `/fr`. Vérifiez que `/en`, `/es`, `/de`, etc. répondent en 200, sont rendus côté serveur, et que le contenu est présent dans le HTML initial (test : `curl -s https://oneshoplab.com/en | grep -i "<h1"` doit renvoyer le titre, pas une coquille vide hydratée ensuite).

---

## 2. hreflang réciproques + x-default (le point que tout le monde rate)

Chaque page doit déclarer TOUTES ses variantes, réciproquement, plus une `x-default`. En Next.js app router, via `generateMetadata` :

```typescript
// app/[lang]/blog/[slug]/page.tsx

const LOCALES = ['fr','en','es','de','it','pt','ru','pl','tr','ar','zh','ja','ko'] as const;
const BASE = 'https://oneshoplab.com';

export async function generateMetadata({ params }: { params: { lang: string; slug: string } }) {
  const { lang, slug } = params;

  const languages: Record<string, string> = {};
  for (const l of LOCALES) {
    languages[l] = `${BASE}/${l}/blog/${slug}`;
  }
  // x-default = version servie quand aucune langue ne correspond. EN est le choix standard.
  languages['x-default'] = `${BASE}/en/blog/${slug}`;

  return {
    alternates: {
      canonical: `${BASE}/${lang}/blog/${slug}`, // self-référent, JAMAIS vers /fr
      languages,
    },
  };
}
```

Points critiques :
- La `canonical` de chaque page pointe vers **elle-même dans sa propre langue**. Une erreur fréquente est de faire pointer toutes les langues vers `/fr` : ça dé-indexe les autres langues.
- Les hreflang doivent être **réciproques** : si `/fr/x` liste `/en/x`, alors `/en/x` doit lister `/fr/x`. Le code ci-dessus le garantit puisqu'il génère la liste complète sur chaque page.
- Codes : utilisez `fr`, `en`, `es`... Si un jour vous différenciez `en-US` / `en-GB`, ajoutez-les, mais ne le faites pas prématurément.

---

## 3. Sitemap multilingue

Un sitemap qui expose chaque variante linguistique avec ses alternates. En Next.js, `app/sitemap.ts` :

```typescript
import type { MetadataRoute } from 'next';

const LOCALES = ['fr','en','es','de','it','pt','ru','pl','tr','ar','zh','ja','ko'];
const BASE = 'https://oneshoplab.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const slugs = ['fiches-produits-ne-convertissent-pas']; // alimenté dynamiquement

  const entries: MetadataRoute.Sitemap = [];
  for (const slug of slugs) {
    for (const lang of LOCALES) {
      entries.push({
        url: `${BASE}/${lang}/blog/${slug}`,
        lastModified: new Date(),
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map(l => [l, `${BASE}/${l}/blog/${slug}`])
          ),
        },
      });
    }
  }
  return entries;
}
```

Si le volume devient gros (>50k URLs), passez à un index de sitemaps segmentés par langue. Pas un souci tant que vous démarrez.

---

## 4. Balise html lang + dir

Chaque page doit servir le bon attribut `lang`, et `dir="rtl"` pour l'arabe. Dans `app/[lang]/layout.tsx` :

```typescript
export default function RootLayout({ children, params }: { children: React.ReactNode; params: { lang: string } }) {
  const dir = params.lang === 'ar' ? 'rtl' : 'ltr';
  return (
    <html lang={params.lang} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
```

---

## 5. Search Console & GA4 segmentés (le mécanisme de décision)

C'est ce qui transforme « totalement ouvert » en stratégie pilotée par les données.

- **Search Console** : filtrez par dossier d'URL (`/fr/`, `/en/`...) pour voir quelle langue capte des impressions et des clics. Créez aussi un filtre par pays.
- **GA4** : créez une exploration segmentée par langue de l'interface ET par pays. Le chiffre qui décide : **inscriptions par langue/pays**, pas visites.

Règle de décision pour activer une 3ᵉ langue de contenu : si une langue tierce génère un flux d'inscriptions organique **significatif et récurrent sur 4–8 semaines** sans aucun effort éditorial de votre part, c'est le signal qu'il y a un marché à servir. Vous traitez alors cette langue. Pas avant, et jamais sur une intuition.

---

## 6. Ordre d'exécution technique (priorisé)

1. Vérifier URLs distinctes crawlables par langue (test curl ci-dessus).
2. Implémenter hreflang réciproques + x-default + canonical self-référent (section 2). **C'est la priorité absolue** — sans ça, publier en 13 langues nuit au SEO.
3. Sitemap multilingue + soumission Search Console.
4. `html lang` / `dir` correct par langue.
5. Segmentation Search Console + GA4 par langue/pays.
6. Page d'audit gratuit sans inscription (cf. manuel principal, Partie 1) — déclinée FR et EN d'abord.

Les étapes 1–4 sont du pur technique, dans vos cordes, faisables en une session. Faites-les avant de publier le moindre contenu en deuxième langue.

---

## Ce qui NE change pas

Tout le manuel principal reste valable. Vous démarrez le contenu et LinkedIn **en français uniquement** (marché d'entrée à faible friction). L'anglais s'active en transposition une fois les premiers gagnants identifiés dans Search Console — pas en parallèle dès le jour 1. L'infra technique multilingue, elle, se met en place dès maintenant parce qu'elle conditionne tout le reste.
