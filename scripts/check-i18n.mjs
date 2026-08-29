#!/usr/bin/env node
/**
 * i18n gate (fails the build/CI on):
 *   1. PARITY — every key present in messages/en.json exists in every other
 *      locale, and no locale carries keys unknown to en.json. next-intl
 *      throws at runtime on a missing key in the matched locale, so a hole
 *      in ar.json is a crash for Arabic users, not a cosmetic issue
 *      (bug found 2026-08-29: Dashboard.jobScopeSiteWide missing in 4 locales).
 *   2. USAGE — every static t('key') / t.rich('key') / t.has('key') call in
 *      src/ resolves to an existing key in en.json, given the namespace the
 *      translator was created with (useTranslations('NS') /
 *      getTranslations('NS') / getTranslations({ namespace: 'NS' })).
 *      Template-literal keys are skipped (dynamic by nature).
 *
 * Usage: node scripts/check-i18n.mjs        (exit 1 on any finding)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MESSAGES = join(ROOT, 'messages');
const SRC = join(ROOT, 'src');

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

// ---- 1. parity -----------------------------------------------------------
const locales = readdirSync(MESSAGES).filter((f) => f.endsWith('.json'));
const en = flatten(JSON.parse(readFileSync(join(MESSAGES, 'en.json'), 'utf8')));
console.log(`i18n: ${locales.length} locales, ${en.size} keys in en.json`);
for (const file of locales) {
  if (file === 'en.json') continue;
  const keys = flatten(JSON.parse(readFileSync(join(MESSAGES, file), 'utf8')));
  for (const k of en) if (!keys.has(k)) fail(`${file}: missing key ${k}`);
  for (const k of keys) if (!en.has(k)) fail(`${file}: unknown key ${k} (not in en.json)`);
}

// ---- 2. usage ------------------------------------------------------------
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const NS_DECL =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([\w.]+)'|\{[^}]*namespace:\s*'([\w.]+)'[^}]*\})\s*\)/g;
const CALL = /\b(\w+)(?:\.rich|\.has|\.markup|\.raw)?\(\s*'([^'\n]+)'/g;
let checked = 0;
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  // Every translator declaration with its position. A file often creates
  // several (`const t = getTranslations('A')` in generateMetadata, another
  // `t` for 'B' in the page component), so a call resolves to the NEAREST
  // PRECEDING declaration of the same name — a good approximation of
  // lexical scope for the sequential-functions shape this codebase uses.
  const decls = [...src.matchAll(NS_DECL)].map((m) => ({
    name: m[1],
    ns: m[2] ?? m[3],
    at: m.index
  }));
  if (decls.length === 0) continue;
  const names = new Set(decls.map((d) => d.name));
  for (const m of src.matchAll(CALL)) {
    const [, name, literal] = m;
    if (!names.has(name)) continue;
    const decl = decls.filter((d) => d.name === name && d.at < m.index).at(-1);
    if (!decl) continue;
    const key = `${decl.ns}.${literal}`;
    checked += 1;
    if (!en.has(key)) {
      // A namespace-level object key (t.raw('section')) is legitimate.
      const isParent = [...en].some((k) => k.startsWith(`${key}.`));
      if (!isParent) fail(`${relative(ROOT, file)}: ${name}('${literal}') → ${key} not in en.json`);
    }
  }
}
console.log(`i18n: ${checked} static t() calls checked`);

if (failures) {
  console.error(`\ni18n check FAILED (${failures} finding${failures > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('i18n check OK ✓');
