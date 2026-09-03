/**
 * App icons for the installable app and the store listings, rendered from the
 * one logo we already ship. Run after changing `public/osl-dark.svg`:
 *
 *   node scripts/ops/generate-app-icons.mjs
 *
 * The brand is a black monogram on white, and the icons say the same: a filled
 * white tile reads as an app where a transparent glyph reads as a bookmark. The
 * maskable variant keeps the monogram inside the 80% safe circle Android crops
 * to, and the badge is a bare silhouette — Android paints the status-bar badge
 * from alpha only, so anything coloured there comes out as a white square.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'public/icons');
const INK = '#191A19';
const PAPER = '#ffffff';

/** The logo with every fill swapped for `color`, sized to `size`. */
async function logo(color, size) {
  const svg = (await readFile(resolve(ROOT, 'public/osl-dark.svg'), 'utf8')).replaceAll(
    '#191A19',
    color
  );
  return sharp(Buffer.from(svg)).resize(size, size, { fit: 'contain', background: '#00000000' });
}

/** A rounded square of `background` with the monogram centred at `logoRatio`. */
async function tile({ size, background, logoColor, logoRatio, radius }) {
  const inner = Math.round(size * logoRatio);
  const mark = await (await logo(logoColor, inner)).png().toBuffer();
  const rounded = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${background}"/></svg>`
  );
  return sharp(rounded)
    .composite([
      { input: mark, top: Math.round((size - inner) / 2), left: Math.round((size - inner) / 2) }
    ])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Home-screen icons. `any` keeps a soft radius of its own; `maskable` is a
  // full bleed square because the platform crops it to its own shape.
  await writeFile(
    resolve(OUT, 'icon-192.png'),
    await tile({ size: 192, background: PAPER, logoColor: INK, logoRatio: 0.66, radius: 40 })
  );
  await writeFile(
    resolve(OUT, 'icon-512.png'),
    await tile({ size: 512, background: PAPER, logoColor: INK, logoRatio: 0.66, radius: 108 })
  );
  await writeFile(
    resolve(OUT, 'icon-maskable-512.png'),
    await tile({ size: 512, background: PAPER, logoColor: INK, logoRatio: 0.5, radius: 0 })
  );
  // iOS never rounds a transparent PNG and never shows one well: opaque, square.
  await writeFile(
    resolve(OUT, 'apple-touch-icon.png'),
    await tile({ size: 180, background: PAPER, logoColor: INK, logoRatio: 0.66, radius: 0 })
  );
  // Status-bar badge: alpha only.
  await writeFile(resolve(OUT, 'badge-96.png'), await (await logo('#ffffff', 96)).png().toBuffer());
  console.log('icons written to public/icons');
}

await main();
