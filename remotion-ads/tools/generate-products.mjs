#!/usr/bin/env node
// OneShopLab Remotion ads — AI product-photo generator (kie.ai unified jobs API,
// model gpt-image-2-text-to-image). Mirrors the Reldreth tools/generate-assets.mjs
// pattern: a JSON manifest is the source of truth, each generated image gets a
// sibling .json record (prompt + taskId + url + date) so it's trivial to regen.
//
// Usage:
//   node tools/generate-products.mjs --check                 # verify API key only
//   node tools/generate-products.mjs                         # run tools/products.manifest.json
//   node tools/generate-products.mjs path/to/manifest.json   # run a custom manifest
//   node tools/generate-products.mjs --only sneaker-studio   # run a single job by name
//   node tools/generate-products.mjs --force                 # regen even if file exists
//
// API key: env KIE_API_KEY → tools/.env → the main app's ../.env. Never commit it.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, ".."); // remotion-ads/
const OUT_DIR = path.join(ROOT, "public", "products");
const DEFAULT_MANIFEST = path.join(HERE, "products.manifest.json");
const DEFAULT_MODEL = "gpt-image-2-text-to-image";

// --- Style anchor: premium, photoreal, advertising-grade e-commerce photography ---
const STYLE_ANCHOR =
  "STYLE: premium photorealistic commercial product photography for a high-end " +
  "e-commerce brand. Tack-sharp focus, soft diffused professional studio lighting, " +
  "realistic materials, true-to-life color, subtle natural reflections, high dynamic " +
  "range, clean and uncluttered, advertising quality, shot on a full-frame camera.";

const WHITE_SUFFIX =
  "The product is centered on a pure seamless pure-white studio background " +
  "(#FFFFFF) with a soft, realistic contact shadow directly beneath it — a clean " +
  "e-commerce packshot.";

const NEGATIVE =
  "Avoid: cartoon, illustration, 3d render, cgi, plastic fake look, low resolution, " +
  "blurry, out of focus, watermark, any text, letters, numbers, brand logos or label " +
  "writing, distorted proportions, extra or deformed parts, oversaturated, harsh " +
  "on-camera flash, cluttered busy background, amateurish, ugly.";

const VALID_SIZES = new Set(["auto", "1:1", "9:16", "16:9", "4:3", "3:4"]);

let FORCE = false;

function getApiKey() {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY.trim();
  const candidates = [path.join(HERE, ".env"), path.resolve(ROOT, "..", ".env")];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*KIE_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return null;
}

function getBaseUrl() {
  if (process.env.KIE_BASE_URL) return process.env.KIE_BASE_URL.trim().replace(/\/$/, "");
  for (const envPath of [path.join(HERE, ".env"), path.resolve(ROOT, "..", ".env")]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*KIE_BASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim().replace(/\/$/, "");
    }
  }
  return "https://api.kie.ai";
}

function buildPrompt(job) {
  if (job.raw) return job.prompt;
  const white = job.white ? `\n\n${WHITE_SUFFIX}` : "";
  return `${STYLE_ANCHOR}\n\n${job.prompt}${white}\n\n${NEGATIVE}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createTask(base, key, job) {
  const input = {
    prompt: buildPrompt(job),
    aspect_ratio: job.size || "1:1",
    resolution: job.resolution || "1K",
    ...(job.input || {}),
  };
  const res = await fetch(`${base}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: job.model || DEFAULT_MODEL, input }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.code !== 200 || !json.data?.taskId) {
    throw new Error(`createTask failed (code ${json.code}): ${json.msg || JSON.stringify(json)}`);
  }
  return json.data.taskId;
}

function extractUrls(resultJson) {
  if (!resultJson) return [];
  try {
    const parsed = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
    return parsed.resultUrls || [];
  } catch {
    return [];
  }
}

async function pollTask(base, key, taskId, { timeoutMs = 300000, everyMs = 3000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(everyMs);
    const res = await fetch(`${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json().catch(() => ({}));
    const d = json.data || {};
    const state = d.state;
    process.stdout.write(`\r   state=${state}            `);
    if (state === "success") {
      process.stdout.write("\n");
      return extractUrls(d.resultJson);
    }
    if (state === "fail") {
      process.stdout.write("\n");
      throw new Error(`task failed: ${d.failMsg || d.failCode || "unknown"}`);
    }
  }
  throw new Error("timeout waiting for task");
}

// kie's file-upload service lives on a separate host from the jobs API.
const UPLOAD_API = "https://kieai.redpandaai.co";

// Upload a local image to kie's temp store (kept 3 days) → returns a public URL
// usable as an image-to-image reference, so every angle keeps the SAME product.
async function uploadBase64(_apiBase, key, localName) {
  const filePath = path.join(OUT_DIR, localName);
  const b64 = `data:image/png;base64,${readFileSync(filePath).toString("base64")}`;
  const res = await fetch(`${UPLOAD_API}/api/file-base64-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data: b64, uploadPath: "oneshoplab-ads", fileName: localName }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.data?.downloadUrl) {
    throw new Error(`base upload failed: ${json.msg || JSON.stringify(json)}`);
  }
  return json.data.downloadUrl;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return dest;
}

async function runJob(base, key, job, i, total) {
  const tag = `[${i}/${total}] ${job.name}`;
  if (!VALID_SIZES.has(job.size || "1:1")) {
    console.log(`✗ ${tag} — invalid size "${job.size}" (use auto, 1:1, 9:16, 16:9, 4:3, 3:4)`);
    return false;
  }
  const primaryDest = path.join(OUT_DIR, `${job.name}.png`);
  if (!FORCE && existsSync(primaryDest)) {
    console.log(`• ${tag} — skip (already exists, use --force to regen)`);
    return true;
  }
  console.log(`→ ${tag} (${job.size || "1:1"}, ${job.resolution || "1K"})${job.base ? ` [i2i ← ${job.base}]` : ""}`);
  try {
    if (job.base) {
      const refUrl = await uploadBase64(base, key, job.base);
      job = {
        ...job,
        model: job.model || "gpt-image-2-image-to-image",
        input: { ...(job.input || {}), input_urls: [refUrl] },
      };
    }
    const taskId = await createTask(base, key, job);
    const urls = await pollTask(base, key, taskId);
    if (!urls.length) throw new Error("no resultUrls returned");
    for (let k = 0; k < urls.length; k++) {
      const suffix = urls.length > 1 ? `-${k + 1}` : "";
      const dest = path.join(OUT_DIR, `${job.name}${suffix}.png`);
      await download(urls[k], dest);
      console.log(`  ✓ saved ${path.relative(ROOT, dest)}`);
    }
    await writeFile(
      path.join(OUT_DIR, `${job.name}.json`),
      JSON.stringify(
        {
          ...job,
          model: job.model || DEFAULT_MODEL,
          taskId,
          resolvedPrompt: buildPrompt(job),
          resultUrls: urls,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return true;
  } catch (e) {
    console.log(`  ✗ ${tag} failed: ${e.message}`);
    return false;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else args._ = argv[i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  FORCE = !!args.force;
  const key = getApiKey();
  const base = getBaseUrl();

  if (args.check || !key) {
    if (key) console.log(`✓ API key found (length ${key.length}). Base ${base}. Model ${DEFAULT_MODEL}. Ready.`);
    else {
      console.log("✗ No KIE_API_KEY. Provide it via one of:");
      console.log("   1) env var KIE_API_KEY");
      console.log("   2) remotion-ads/tools/.env  →  KIE_API_KEY=...");
      console.log("   3) the main app's .env (../.env) — picked up automatically");
    }
    if (args.check || !key) return;
  }

  const manifestPath = args._ ? path.resolve(args._) : DEFAULT_MANIFEST;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let jobs = Array.isArray(manifest) ? manifest : manifest.jobs || [];
  if (manifest.model) jobs = jobs.map((j) => ({ model: manifest.model, ...j }));
  if (args.only) jobs = jobs.filter((j) => j.name === args.only);
  if (!jobs.length) {
    console.log("Nothing to do (no jobs matched).");
    return;
  }

  console.log(`Generating ${jobs.length} product image(s) via kie.ai (${DEFAULT_MODEL})…\n`);
  let ok = 0;
  for (let i = 0; i < jobs.length; i++) if (await runJob(base, key, jobs[i], i + 1, jobs.length)) ok++;
  console.log(`\nDone. ${ok}/${jobs.length} succeeded. Output in public/products/.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
