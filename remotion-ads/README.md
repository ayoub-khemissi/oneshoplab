# OneShopLab — Facebook Ads (Remotion)

Short "screencast épuré" promo video for Facebook/Instagram Ads, in **5 languages
× 2 formats**. Isolated from the main Next.js app — it has its **own `package.json`**
(like `tools/email-scraper`). Don't merge its deps into the root app.

## Concept (≈ 20 s)

A clean, fake-but-real screen recording of the OneShopLab UI:

1. **Intro** — wordmark + « Your catalog. Optimized by AI. » (Shopify · WooCommerce · Wix)
2. **Import** — the dashboard with a Shopify catalog synced, real product photos with low scores
3. **Optimization** — cursor clicks **Generate all**, then the SEO title types itself in,
   the description + tags appear, the product photo is cut-out/enhanced, the score jumps 48 → 92
4. **CTA** — « Try OneShopLab for free » · oneshoplab.com

Brand colors, fonts (Geist), logo and the real UI strings are pulled from the app.

## Languages × formats → 10 compositions

Locales: **en, fr, es, de, it** · Formats: **Square 1:1** (feed) and **Vertical 9:16** (Stories/Reels).

Composition ids follow `Ad-<LOCALE>-<Format>`, e.g. `Ad-FR-Square`, `Ad-DE-Vertical`.
All copy lives in **`src/i18n.ts`** — edit one dictionary, every language updates.
The vertical version auto-adds a localized top headline + bottom brand band.

## Commands

```bash
pnpm install
pnpm studio                       # open the Remotion preview (pick a locale from the sidebar)

pnpm render:all                   # render all 10 videos → out/oneshoplab-<locale>-<format>.mp4
pnpm render:fr                    # both formats for one locale
node tools/render-all.mjs fr square   # a single video
npx remotion render Ad-DE-Vertical out/de-vertical.mp4   # fully manual
```

Output is H.264 / yuv420p — plays everywhere (Ads Manager, iOS, Android, desktop).

## Carousel (static cards for Meta)

A companion to the video: **5 square 1080×1080 cards** per locale, to run as a
second Ad in the same ad set (covers users who swipe instead of watch, and cuts
ad fatigue). Cards: 1) hook/problem · 2) AI SEO copy · 3) before/after photo ·
4) integration hub · 5) CTA. Copy lives in `src/i18n.ts` (`carousel`), visuals
in `src/carousel/CarouselCard.tsx`.

```bash
pnpm render:carousel            # all 5 locales × 5 cards → out/carousel/oneshoplab-<locale>-card<N>.png
node tools/render-carousel.mjs fr   # one locale
```

Preview in Studio: composition **`Card`** (change `locale` / `card` in the props panel).

## Product photos (kie.ai, gpt-image-2)

The product shots are **AI-generated** and committed to `public/products/`. They are
driven by a JSON manifest so they're trivial to regenerate or swap.

```bash
node tools/generate-products.mjs --check          # verify the kie API key is found
pnpm gen:products                                 # generate any missing images
node tools/generate-products.mjs --only watch --force   # regen one
```

- **Manifest / source of truth**: `tools/products.manifest.json` (one job per image — edit a prompt and re-run).
- **API**: kie.ai unified jobs API, model `gpt-image-2-text-to-image`. Key read from
  `KIE_API_KEY` (env → `tools/.env` → the main app's `../.env`, picked up automatically).
- Each generated image gets a sibling `<name>.json` record (resolved prompt + taskId + date).
- **Prompts are English** and forbid any on-image text/logos (clean packshots).

Current set: `sneaker-studio` (hero + catalog thumb), `sneaker-lifestyle`, `sneaker-inuse`
(the 3 AI angles for the example product), plus `watch`, `headphones`, `sunglasses`
(catalog thumbnails). The hero shown in the optimize scene is set in `src/Root.tsx`
(`PRODUCT_SRC`); set it to `null` to fall back to the built-in SVG mock.

## Tuning

- **Copy / translations**: `src/i18n.ts` (all 5 languages, incl. the per-product SEO title/desc/tags).
- **Timing / scene lengths**: `src/Ad.tsx` (`SCENES`), 30 fps.
- **Cursor path / click**: `cursorX` / `cursorY` / `clickFrame` in `OptimizeReveal.tsx`.
- **Catalog products / scores**: `PRODUCTS` array in `ImportCatalog.tsx` (keys map to `i18n` + a `public/products/*.png`).
- **Colors / fonts**: `src/theme.ts` (mirrors `globals.css`).
