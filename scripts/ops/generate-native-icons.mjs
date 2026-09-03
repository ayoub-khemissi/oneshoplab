/**
 * Launcher icons and splash art for the native shells, from the same logo the
 * web app uses. Run after `generate-app-icons.mjs`:
 *
 *   node scripts/ops/generate-native-icons.mjs
 *
 * Android wants a full set of densities (legacy square, legacy round, and the
 * adaptive foreground drawn inside a 66% safe circle), plus a splash image per
 * density and orientation. iOS wants a single 1024 with no alpha channel and no
 * rounded corners — the system rounds it — and the same logo on a white sheet
 * for the launch screen.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANDROID_RES = resolve(ROOT, 'android/app/src/main/res');
const IOS_ASSETS = resolve(ROOT, 'native/ios-assets');
const INK = '#191A19';
const PAPER = '#ffffff';

/** Android's five buckets, and the pixel size of a launcher icon in each. */
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192]
];

/** Splash canvases, portrait and landscape, per density. */
const SPLASH = [
  ['mdpi', 320, 480],
  ['hdpi', 480, 800],
  ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600],
  ['xxxhdpi', 1280, 1920]
];

async function logoBuffer(color, size) {
  const svg = (await readFile(resolve(ROOT, 'public/osl-dark.svg'), 'utf8')).replaceAll(
    '#191A19',
    color
  );
  return sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
}

/** Logo centred on an opaque sheet — the shape platforms mask themselves. */
async function sheet(width, height, logoSize) {
  const mark = await logoBuffer(INK, logoSize);
  return sharp({
    create: { width, height, channels: 4, background: PAPER }
  })
    .composite([
      {
        input: mark,
        top: Math.round((height - logoSize) / 2),
        left: Math.round((width - logoSize) / 2)
      }
    ])
    .png()
    .toBuffer();
}

/** A round mask of the same sheet, for the pre-adaptive launcher. */
async function roundSheet(size, logoSize) {
  const square = await sheet(size, size, logoSize);
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(square)
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  for (const [density, size] of DENSITIES) {
    const dir = resolve(ANDROID_RES, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'ic_launcher.png'), await sheet(size, size, Math.round(size * 0.66)));
    await writeFile(
      resolve(dir, 'ic_launcher_round.png'),
      await roundSheet(size, Math.round(size * 0.6))
    );
    // Adaptive foreground: transparent, and small enough that the system's
    // crop never bites into the monogram.
    await writeFile(
      resolve(dir, 'ic_launcher_foreground.png'),
      await sharp({
        create: { width: size, height: size, channels: 4, background: '#00000000' }
      })
        .composite([
          {
            input: await logoBuffer(INK, Math.round(size * 0.46)),
            top: Math.round((size - size * 0.46) / 2),
            left: Math.round((size - size * 0.46) / 2)
          }
        ])
        .png()
        .toBuffer()
    );
  }

  for (const [density, shortSide, longSide] of SPLASH) {
    const portrait = resolve(ANDROID_RES, `drawable-port-${density}`);
    const landscape = resolve(ANDROID_RES, `drawable-land-${density}`);
    await mkdir(portrait, { recursive: true });
    await mkdir(landscape, { recursive: true });
    const logo = Math.round(shortSide * 0.4);
    await writeFile(resolve(portrait, 'splash.png'), await sheet(shortSide, longSide, logo));
    await writeFile(resolve(landscape, 'splash.png'), await sheet(longSide, shortSide, logo));
  }
  // The density-less fallback the generated theme points at.
  await mkdir(resolve(ANDROID_RES, 'drawable'), { recursive: true });
  await writeFile(resolve(ANDROID_RES, 'drawable/splash.png'), await sheet(1280, 1920, 512));

  // iOS: one opaque 1024 (the App Store rejects alpha) and the launch sheet.
  await mkdir(IOS_ASSETS, { recursive: true });
  await writeFile(
    resolve(IOS_ASSETS, 'AppIcon-1024.png'),
    await sharp(await sheet(1024, 1024, 676)).flatten({ background: PAPER }).png().toBuffer()
  );
  await writeFile(resolve(IOS_ASSETS, 'LaunchImage.png'), await sheet(2732, 2732, 800));

  console.log('native icons + splash written');
}

await main();
