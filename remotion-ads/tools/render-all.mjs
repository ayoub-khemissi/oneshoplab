#!/usr/bin/env node
// Render every locale × format to out/ with friendly filenames.
//   node tools/render-all.mjs                 # all 10
//   node tools/render-all.mjs fr              # both formats for one locale
//   node tools/render-all.mjs fr square       # a single video
import { spawnSync } from "node:child_process";

const LOCALES = ["en", "fr", "es", "de", "it"];
const FORMATS = ["Square", "Vertical"];

const [localeArg, formatArg] = process.argv.slice(2).map((s) => s?.toLowerCase());
const locales = localeArg ? [localeArg] : LOCALES;
const formats = formatArg ? [FORMATS.find((f) => f.toLowerCase() === formatArg)] : FORMATS;

let ok = 0;
let total = 0;
for (const locale of locales) {
  for (const format of formats) {
    if (!format) continue;
    total++;
    const comp = `Ad-${locale.toUpperCase()}-${format}`;
    const out = `out/oneshoplab-${locale}-${format.toLowerCase()}.mp4`;
    console.log(`\n▶ Rendering ${comp} → ${out}`);
    const r = spawnSync("npx", ["remotion", "render", comp, out], {
      stdio: "inherit",
      shell: true,
    });
    if (r.status === 0) ok++;
    else console.error(`✗ ${comp} failed (exit ${r.status})`);
  }
}
console.log(`\nDone. ${ok}/${total} rendered into out/.`);
process.exit(ok === total ? 0 : 1);
