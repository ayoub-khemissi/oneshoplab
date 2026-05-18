# Migration R2 → cdn.oneshoplab.com (NIVEAU 2 — bucket privé)

Objectif : servir les images via `https://cdn.oneshoplab.com/...`, bucket R2
**réellement privé** (accès public r2.dev coupé), nginx signe chaque requête en
AWS SigV4 avec une clé R2 **read-only dédiée**. DNS reste sur Hostinger.

```
navigateur → cdn.oneshoplab.com (nginx + njs SigV4, cache disque)
           → <account>.r2.cloudflarestorage.com/oneshoplab/<clé>  (API S3 privée)
```

Le code app est déjà déployé et rétro-compatible (`keyFromPublicUrl` multi-base
+ `R2_PUBLIC_URL_ALIASES`). r2.dev reste actif jusqu'à l'étape 9 → zéro downtime.

---

## Pré-requis (toi, en parallèle — ça propage)

1. **DNS Hostinger** : A `cdn` → `217.182.198.21` (AAAA `cdn` →
   `2001:41d0:700:315::1` optionnel). Vérif : `dig +short cdn.oneshoplab.com`.
2. **Token R2 read-only** : Cloudflare → R2 → *Manage R2 API Tokens* →
   Create → **Object Read only** → bucket **`oneshoplab`** uniquement.
   Note : Access Key ID + Secret Access Key + ton **Account ID** (visible
   dans l'URL du dashboard R2 / endpoint S3).

---

## Étapes sur la box (guidées, sudo)

### 4. Module njs
```bash
sudo apt-get update && sudo apt-get install -y libnginx-mod-http-js
# auto-active via /etc/nginx/modules-enabled/. Vérif :
nginx -V 2>&1 | tr ' ' '\n' | grep -i js || ls /etc/nginx/modules-enabled/
```

### 5. Module de signature + secrets root-only
```bash
sudo mkdir -p /etc/nginx/njs
sudo cp /home/ubuntu/oneshoplab/oneshoplab/deploy/r2-sign.js /etc/nginx/njs/r2-sign.js
sudo chmod 644 /etc/nginx/njs/r2-sign.js

sudo cp /home/ubuntu/oneshoplab/oneshoplab/deploy/r2-cdn-secrets.conf.template \
        /etc/nginx/conf.d/00-r2-cdn-secrets.conf
sudo chmod 600 /etc/nginx/conf.d/00-r2-cdn-secrets.conf
sudo nano /etc/nginx/conf.d/00-r2-cdn-secrets.conf   # remplir les 3 placeholders
```
(Tu me donnes les valeurs, je remplis le fichier root-only — il n'est jamais
commité.)

### 6. Vhost (bootstrap port 80 d'abord pour l'ACME)
```bash
sudo mkdir -p /var/cache/nginx/r2cdn && sudo chown www-data: /var/cache/nginx/r2cdn
sudo cp /home/ubuntu/oneshoplab/oneshoplab/deploy/nginx-cdn.conf \
        /etc/nginx/conf.d/cdn.oneshoplab.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Certificat
```bash
sudo certbot --nginx -d cdn.oneshoplab.com
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Vérifier la signature SigV4 PENDANT que r2.dev tourne encore
```bash
# Prendre une clé existante (ex. depuis products.images d'un produit) :
curl -sI "https://cdn.oneshoplab.com/products/<projectId>/<uuid>.png"
# Attendu : HTTP/2 200, content-type image/*, X-Cache-Status: MISS→HIT.
# 403 = signature KO (vérifier account id / clé / horloge box `date -u`).
```
Tant que ça ne renvoie pas 200, **on ne touche à rien d'autre** (r2.dev sert
encore l'app normalement).

### 9. Bascule app + migration DB
`.env` :
```
R2_PUBLIC_URL=https://cdn.oneshoplab.com
R2_PUBLIC_URL_ALIASES=https://pub-950d1ead59e24488b51979d2c249e71a.r2.dev
```
```bash
cd /home/ubuntu/oneshoplab/oneshoplab
pm2 restart oneshoplab-web oneshoplab-worker --update-env
set -a && source .env && set +a
OLD_BASE=https://pub-950d1ead59e24488b51979d2c249e71a.r2.dev \
NEW_BASE=https://cdn.oneshoplab.com \
pnpm exec tsx --tsconfig tsconfig.json scripts/migrate-r2-urls.ts --dry   # puis sans --dry
```

### 10. Couper l'accès public r2.dev (toi, Cloudflare)
Cloudflare → R2 → bucket `oneshoplab` → **Settings → Public Development URL
(r2.dev) → Disable**. Le bucket devient injoignable sans signature.

### 11. Re-vérif finale
- `curl -sI https://cdn.oneshoplab.com/<clé>` → toujours 200 (via S3 signé)
- `curl -sI https://pub-950d…r2.dev/<clé>` → maintenant **403/404** (bon signe)
- Fiche produit + `/share/<token>` : images OK
- `pm2 logs oneshoplab-worker` : r2-cleanup résout toujours les clés

---

## Sécurité — état final

- ✅ Bucket **privé** : aucun accès direct possible, r2.dev coupé
- ✅ Seul nginx (clé **read-only** dédiée, jamais dans le repo/bundle/navigateur)
  peut lire ; token scopé à un seul bucket, read-only → blast radius minimal
- ✅ Point d'entrée unique : rate-limit / WAF / Referer ajoutables côté nginx
- ✅ Cache disque 30j : egress R2 minimal, résilience si R2 down
- ✅ Lecture seule stricte (méthode ≠ GET/HEAD → 405), cookies/credentials
  jamais transmis à R2, headers provider masqués, TLS+HSTS

## Rollback
Avant l'étape 10 : remettre `R2_PUBLIC_URL` sur r2.dev + `pm2 restart`. Après
l'étape 10 : réactiver r2.dev public dans Cloudflare (instantané) puis rollback
`.env`. Aucune image perdue — la clé read-only ne peut rien supprimer.
