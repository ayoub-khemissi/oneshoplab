# Manuel d'exécution — Lancer le marketing de OneShopLab

Cible : agences et freelances e-commerce. Canal moteur : SEO / contenu. Renfort : LinkedIn.
Ce document décrit **exactement** quoi faire, dans quel ordre, où, et quand. Suivez-le de haut en bas.

---

## PARTIE 0 — Les comptes à créer (à faire en premier, ~2 heures)

Créez ces comptes dans cet ordre. Tout est gratuit pour démarrer sauf mention contraire.

### Indispensables (sans eux, rien ne fonctionne)

1. **Google Search Console** — search.google.com/search-console
   À quoi ça sert : prouver à Google que le site vous appartient, soumettre les pages, suivre les positions SEO. Connectez le domaine oneshoplab.com. C'est l'outil n°1 du SEO, non négociable.

2. **Google Analytics 4 (GA4)** — analytics.google.com
   À quoi ça sert : savoir d'où viennent les visiteurs et lesquels s'inscrivent. Installez le code de suivi sur le site (ou via Google Tag Manager si le site le permet).

3. **Compte LinkedIn personnel optimisé** (vous en avez sans doute déjà un)
   Ce n'est PAS une page entreprise au début. Les agences suivent des personnes, pas des logos. Votre profil personnel est votre canal. Voir Partie 3 pour l'optimiser.

### Fortement recommandés

4. **Compte X (Twitter)** — pour la communauté e-commerce/SaaS anglophone et francophone. Secondaire mais utile.

5. **Un outil de mots-clés gratuit** : au choix, **Google Keyword Planner** (gratuit avec un compte Google Ads, sans dépenser) ou l'extension gratuite **Keyword Surfer**. Sert à vérifier que les sujets d'articles sont réellement recherchés.

6. **Un compte d'emailing** (Brevo ou MailerLite, tous deux ont un plan gratuit). Pas urgent semaine 1, mais à prévoir : capturer les emails des visiteurs de la page d'audit gratuit.

### Pour les visuels

7. **Aucun compte payant nécessaire.** Les trois visuels que je vous ai produits dans cette conversation : vous les exportez directement (bouton de téléchargement de chaque widget rendu). Pour les retoucher/recadrer sans logiciel : **Canva** (plan gratuit) ou **Photopea** (gratuit, sans inscription).

> **À ne PAS faire maintenant** : Google Ads, Meta Ads, influenceurs payants. Tant que le message n'est pas validé en organique, c'est du budget brûlé. On y reviendra en phase 3 seulement.

---

## PARTIE 1 — La fondation SEO technique (semaine 1, ~3 heures)

Avant de produire du contenu, le site doit être indexable. Vérifiez chaque point :

1. **Search Console est vérifiée** et le domaine validé (fait en Partie 0).

2. **Soumettre le sitemap.** Dans Search Console → Sitemaps → ajouter `oneshoplab.com/sitemap.xml`. Si le sitemap n'existe pas, demandez-le à votre développeur — Next.js le génère facilement.

3. **Vérifier l'indexation.** Dans Google, tapez `site:oneshoplab.com`. Vous devez voir vos pages. Si presque rien n'apparaît, le site est neuf : normal, la soumission du sitemap accélère.

4. **Créer la section blog** si elle n'existe pas : `oneshoplab.com/fr/blog`. C'est là que tous les articles vivront. Demandez à votre développeur une structure simple : titre, image de couverture, corps en markdown, date, bouton d'appel à l'action.

5. **La page-aimant prioritaire** : une page d'audit gratuit accessible **sans inscription** pour la première analyse. C'est votre meilleur actif SEO. URL : `oneshoplab.com/fr/audit` (slug neutre unique sur les 13 langues — voir `docs/audit-infra-seo.md`). Le visiteur colle une URL, voit un score, et l'inscription n'est demandée que pour aller plus loin. Si une seule chose technique doit être priorisée après le sitemap, c'est celle-ci. Discutez-en avec votre développeur dès cette semaine.

---

## PARTIE 2 — Publier l'article pilote (semaine 1–2, ~2 heures)

L'article est déjà rédigé (fichier `article-pilote-oneshoplab.md`). Étapes exactes :

1. **Exporter les 3 visuels** de cette conversation (bouton de téléchargement sous chaque widget). Vous obtenez 3 images PNG :
   - le avant/après
   - le processus 3 étapes
   - le comparatif par profil

2. **Recadrer le visuel avant/après** en format paysage (≈ 1200 × 630 px) pour servir d'image de couverture. Outil : Canva ou Photopea, gratuit.

3. **Copier le corps de l'article** depuis le fichier markdown dans votre CMS/blog. Supprimez le bloc « Notes de production » et les balises `[EMPLACEMENT VISUEL]` après avoir inséré les images aux endroits indiqués.

4. **Renseigner les métadonnées** (fournies en bas de l'article) : balise title, meta description, URL.

5. **Publier**, puis dans Search Console → Inspection d'URL → coller l'URL de l'article → « Demander l'indexation ». Ça accélère la prise en compte par Google.

6. **Vérifier sur mobile.** Plus de la moitié du trafic sera mobile. Ouvrez l'article sur votre téléphone : images lisibles, texte aéré, bouton d'action visible.

> **Important sur le SEO** : un article ne se positionne pas en 3 jours. Comptez **3 à 6 mois** pour que le SEO porte. C'est pour ça que LinkedIn (Partie 3) tourne en parallèle : il donne des résultats en semaines pendant que le SEO mûrit. Ne jugez pas le SEO avant 90 jours.

---

## PARTIE 3 — LinkedIn, le canal qui donne des résultats vite (en continu, ~30 min/jour)

### 3.1 — Optimiser votre profil (une fois, ~1 heure)

- **Titre du profil** : pas « Fondateur de OneShopLab ». Plutôt un titre qui parle aux agences, du type : *« J'aide les agences e-commerce à transformer les fiches produits de leurs clients en revenus »*. Le titre doit nommer la cible et le bénéfice.
- **Section « Infos »** : 3 lignes. Le problème (catalogues qui ne convertissent pas), votre solution (audit + réécriture à l'échelle), un appel à l'action (lien vers l'audit gratuit).
- **Bannière** : utilisez le visuel avant/après recadré au format bannière LinkedIn (1584 × 396 px).

### 3.2 — Quoi poster

Le format qui marche pour cette cible : **le teardown**. Vous prenez une vraie fiche produit faible (anonymisée si besoin), vous montrez le problème, vous montrez la version corrigée, vous concluez par une question ouverte.

Structure d'un post type :
- Ligne 1 (l'accroche, doit donner envie de cliquer « voir plus ») : une affirmation tranchée. Ex. *« La plupart des boutiques que je vois perdent des ventes sans le savoir. Pas à cause du trafic. »*
- 3–4 lignes : le problème concret.
- Le visuel avant/après (les posts avec image performent mieux).
- 2–3 lignes : ce que ça change.
- Dernière ligne : une question ouverte pour déclencher des commentaires. Ex. *« Vous auditeriez les fiches d'un client avant de toucher à ses pubs ? »*

Chaque audit que vous faites tourner = un post potentiel. **Le produit fabrique votre contenu.**

### 3.3 — Quand poster

- **Fréquence** : 3 à 4 posts par semaine. La régularité bat la quantité.
- **Jours** : mardi, mercredi, jeudi sont les meilleurs jours B2B. Évitez vendredi après-midi, samedi, dimanche.
- **Heure** : visez **8h–9h** ou **12h–13h** (heure de Paris). Les décideurs B2B consultent LinkedIn le matin avant de travailler et à la pause déjeuner. Postez juste avant ces créneaux.
- **Règle d'or de l'engagement** : restez disponible **30 à 60 minutes après publication** pour répondre à chaque commentaire. L'algorithme LinkedIn pousse les posts qui génèrent des échanges dans la première heure. Un post sans réponses de l'auteur retombe.

### 3.4 — Ne jamais faire

- Ne postez pas de lien dans le corps du post (LinkedIn pénalise les liens sortants). Mettez le lien en **premier commentaire**, et écrivez « lien en commentaire » à la fin du post.
- Ne spammez pas les groupes/DM avec des messages promo. Apportez de la valeur publiquement.
- N'achetez jamais d'abonnés ou d'engagement.

---

## PARTIE 4 — Les communautés (en continu, ~20 min/jour)

Où sont vos prospects agences :

- **Groupes Facebook** : recherchez « Shopify France », « E-commerce France », « Dropshipping francophone », « Freelances marketing ». Demandez à rejoindre, lisez les règles.
- **Reddit** : r/shopify, r/ecommerce, r/AgencyGrowth, r/FulfillmentByAmazon (anglophone mais actif).
- **Discord** : vous avez déjà un serveur (lien sur le site). Animez-le avec un **audit public hebdomadaire** : quelqu'un poste l'URL d'une boutique, vous montrez l'audit en direct. C'est votre meilleure démo récurrente.
- **Slack/communautés d'agences** francophones si vous en connaissez.

**La seule règle qui compte** : vous n'êtes JAMAIS là pour vendre. Vous êtes là pour aider. Quelqu'un se plaint que ses ventes stagnent → vous proposez un audit gratuit de sa boutique, sans rien demander. La valeur d'abord. Le produit se vend de lui-même quand le résultat est visible. Une seule pub déguisée et vous êtes banni de la communauté.

---

## PARTIE 5 — Le calendrier des 90 jours (vue d'ensemble)

### Semaines 1 à 3 — Fabriquer les munitions
- Créer tous les comptes (Partie 0).
- Fondation SEO technique (Partie 1).
- Publier l'article pilote (Partie 2).
- Optimiser le profil LinkedIn (Partie 3.1).
- Faire tourner 15 à 20 audits sur de vraies boutiques → constituer une banque de visuels avant/après.
- Lancer la page d'audit gratuit sans inscription (le plus important techniquement).

### Semaines 4 à 8 — Diffuser
- LinkedIn : 3–4 posts/semaine, format teardown.
- Publier 1 nouvel article tous les 15 jours (Famille 1 d'abord — voir l'architecture de contenu).
- Présence active dans 3 à 5 communautés, audits gratuits offerts.
- Objectif chiffré : vos 10 premiers utilisateurs et **3 à 5 témoignages avec résultat concret**.

### Semaines 9 à 12 — Amplifier
- Mettre en avant les témoignages obtenus (posts, page de vente).
- Lancer un programme de parrainage : crédits offerts au parrain ET au filleul (votre modèle de crédits s'y prête parfaitement).
- Seulement maintenant : tester un petit budget pub (100–300 €) sur l'angle qui a le mieux marché en organique, créa = visuel avant/après en carrousel.
- Analyser dans Search Console quels articles se positionnent → doubler la mise sur ces sujets.

---

## PARTIE 6 — Ce qu'il faut mesurer (et ignorer)

**Regardez chaque semaine :**
- Search Console : impressions et clics sur les articles (la tendance, pas le chiffre absolu).
- GA4 : nombre de visiteurs → nombre d'inscriptions (le taux de conversion).
- LinkedIn : commentaires et messages reçus (pas le nombre de likes).
- Le seul chiffre qui compte vraiment : **nombre de comptes créés** et **nombre qui passent au payant**.

**Ignorez :**
- Le nombre de likes sur LinkedIn (vanité).
- La position SEO avant 90 jours (trop tôt, ça démoralise pour rien).
- Le nombre d'abonnés (un public engagé de 200 personnes vaut mieux que 5 000 fantômes).

---

## La règle qui résume tout

Votre meilleur outil marketing n'est pas un canal, c'est **le produit lui-même**. Chaque audit gratuit que vous lancez est en même temps : une démo, une preuve, un post de réseau social, un argument commercial. Ne traitez pas « le produit » et « le marketing » comme deux choses séparées. La machine à contenu, c'est l'outil d'audit. Si vous deviez ne retenir qu'une phrase de ce manuel, c'est celle-là.
