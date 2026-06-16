#!/usr/bin/env node
// Render the 5 carousel cards as 1080×1080 PNG stills, per locale.
//   node tools/render-carousel.mjs            # all 5 locales × 5 cards = 25
//   node tools/render-carousel.mjs fr         # one locale (5 cards)
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const LOCALES = ["en", "fr", "es", "de", "it"];
const arg = process.argv[2]?.toLowerCase();
const locales = arg ? [arg] : LOCALES;

mkdirSync(path.resolve(HERE, "..", "out", "carousel"), { recursive: true });
const propsPath = path.join(HERE, ".carousel-props.json").replace(/\\/g, "/");

let ok = 0;
let total = 0;
for (const locale of locales) {
  for (let card = 1; card <= 5; card++) {
    total++;
    writeFileSync(propsPath, JSON.stringify({ locale, card }));
    const out = `out/carousel/oneshoplab-${locale}-card${card}.png`;
    console.log(`▶ ${out}`);
    const r = spawnSync("npx", ["remotion", "still", "Card", out, `--props=${propsPath}`], {
      stdio: "inherit",
      shell: true,
    });
    if (r.status === 0) ok++;
    else console.error(`✗ ${locale} card ${card} failed (exit ${r.status})`);
  }
}
console.log(`\nDone. ${ok}/${total} cards rendered into out/carousel/.`);
process.exit(ok === total ? 0 : 1);
