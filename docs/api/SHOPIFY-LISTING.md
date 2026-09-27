# Shopify App Store listing — field by field

Status: drafted 2026-09-27, filled in the Partner Dashboard, not submitted.
Every value below fits the form's limits and follows the listing rules: no
prices outside Pricing details, no statistics, no reviews, no superlatives,
no other platforms.

## Basic app information

- **App name:** OneShopLab
- **App icon:** upload it in the Dev Dashboard (app settings). Use the white
  OSL mark on brand blue `#0073eb`, 1200×1200.
- **Primary category:** Store design → Content (Product content)
- **Secondary category (optional):** Store design → Site optimization (SEO)
- **Languages:** English (the listing). The app itself runs in English,
  French, German, Spanish, Italian, Portuguese, Polish, Turkish, Russian,
  Arabic, Japanese, Korean and Chinese (Simplified).

## App store listing content

**Introduction (99/100):**
Audit your catalog, then improve titles, descriptions, tags and photos with AI. You approve it all.

**App details (443/500):**
OneShopLab scores every product page and shows what holds it back: thin descriptions, weak titles, missing tags or alt text, poor photos. Generate better versions in your store's language, compare them side by side and publish only what you approve. Create clean product photos (white background, in use, lifestyle) or transparent cut-outs. Work on one product or a whole collection at once. Nothing changes in your store until you approve it.

**Features (≤80 each):**
1. A score for every product page, with the fixes that matter most
2. AI titles, descriptions, tags and alt text in your store's language
3. Product photos: white background, in use, lifestyle, transparent cut-outs
4. Bulk generation for whole collections, reviewed before anything is published
5. Approved changes are written back to your Shopify products

**Feature media:**
- Video: the site's hero video (`public/videos/hero-desktop.mp4`, 30 s),
  on YouTube as unlisted with comments off.
- Thumbnail: a 1600×900 frame of the same video, cut without the Shopify
  badge (feature media must not show the Shopify logo).

**Screenshots (1600×900, alt text ≤64):** retaken in embedded mode once the
full app runs inside the admin. The alt texts:
1. Store overview with the overall catalog score
2. Product list with a score and the issues found on each product
3. AI-rewritten SEO title and description next to the original
4. Generated product photos: white background, in use, lifestyle
5. Lifestyle and in-use photos generated for a home decor product

No screenshot may show prices (4.2.2). The embedded home with the plans is
therefore left out.

**Support:**
- Support email: contact@oneshoplab.com (preferred channel)
- Support portal (optional): https://oneshoplab.com/en/contact

**Resources:**
- Privacy policy: https://oneshoplab.com/en/privacy
- Developer website: https://oneshoplab.com
- FAQ: https://oneshoplab.com/en/faq

## Pricing details

These are Shopify Billing plans; the yearly option is 20% off.

| Display name | Price | Top features |
| --- | --- | --- |
| Free | Free | 150 credits to start · 1 store · up to 200 products |
| Starter | $46.99 / month, or $451.10 / year | 5,500 credits every month · 3 stores · up to 1,000 products |
| Pro | $104.99 / month, or $1,007.90 / year | 15,000 credits every month · 10 stores · up to 5,000 products |
| Scale | $234.99 / month, or $2,255.90 / year | 38,000 credits every month · 50 stores · up to 20,000 products |

Additional charges: one-time credit packs, bought in the app through Shopify,
from $5.99. Leave the "outside the Billing API" box unchecked.

## App discovery content

- **App card subtitle (61/62):** Rewrite product titles, descriptions, tags and photos with AI
- **Search terms (≤20 each):** product description · product photos · alt text · SEO · catalog audit
- **Title tag (52/60):** OneShopLab: AI product descriptions, tags and photos
- **Meta description (157/160):** Audit your product pages, then rewrite titles, descriptions, tags and alt text and create product photos with AI. Nothing is published without your approval.

## Install requirements

- **Sales channel:** "My app doesn't require the Shopify Online Store or
  Shopify POS". The app only edits products through the Admin API.
- **Geographic requirements:** none.

## Contact information

- **Merchant review email:** contact@oneshoplab.com
- **App submission email:** the Partner account's email; allowlist
  noreply@shopify.com.

## App testing information

- **Test account:** "My app doesn't require an account to use it". The app
  creates the merchant's account from the store on first open.
- **Screencast URL:** the unlisted YouTube walkthrough. Re-record it once
  the full app opens inside the admin.
- **Testing instructions (≤2800):**

```
OneShopLab audits a store's product catalog and rewrites titles, descriptions, tags, alt text and photos with AI. Nothing is published to the store without the merchant's approval.

1. Install the app and open it from the Shopify admin.
2. Click "Create my workspace". The account is created from the store owner's email with 150 free credits. No password or separate login is needed.
3. The home page shows the catalog score, synced products, pending changes and credits. Products are pulled automatically; "Sync now" pulls them again. The score appears about a minute after the first sync.
4. Click "Open OneShopLab". The full app opens inside the Shopify admin.
   - Overview: the catalog score and what holds each area back.
   - Products: pick a product, then "Generate all" (title, description, tags and 3 photos).
   - Compare the suggestions with the original, then click "Apply to my store" under a suggestion. The change is written to the Shopify product within a few seconds.
5. Plans and billing: back on the home page, choose a plan (monthly or yearly) or buy a one-time credit pack. Every charge goes through the Shopify Billing API.
   On development stores all charges are test charges. They activate the plan or pack normally, but the credits they grant are capped at 500 per account in total and never refilled, so the app can't be used for free from development stores. The app shows this notice. Charges on paying stores grant the full amount.
6. "Go back to the free plan" cancels the subscription. Uninstalling the app cancels it too.

Mandatory compliance webhooks are handled at /api/webhooks/shopify/gdpr/* (HMAC verified).
```
