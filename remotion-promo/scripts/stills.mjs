// Renders a set of frames to out/stills and tiles them into out/stills/sheet-*.png for review.
// usage: node scripts/stills.mjs [Promo-Vertical] 60 250 560 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const args = process.argv.slice(2);
const id = /^(Promo|Hero)/.test(args[0] ?? "") ? args.shift() : "Promo-Vertical";
const frames = args.map(Number);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const inputProps = { withAudio: false };  // Promo* and HeroStory* both take it
const composition = await selectComposition({ serveUrl, id, inputProps });
for (const frame of frames) {
  await renderStill({ serveUrl, composition, frame, inputProps, output: `out/stills/${id}-${frame}.png`, scale: 0.5 });
  console.log("frame", frame);
}
