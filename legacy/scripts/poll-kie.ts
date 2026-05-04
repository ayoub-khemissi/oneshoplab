import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const KEY = process.env.KIE_API_KEY;
if (!KEY) {
  console.error('KIE_API_KEY not set in .env');
  process.exit(1);
}

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: tsx src/poll-kie.ts <taskId>');
  process.exit(1);
}

interface PollResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    model: string;
    state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
    progress?: number;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
    costTime?: number;
    completeTime?: number;
    createTime?: number;
    updateTime?: number;
    param?: string;
  };
}

const url = `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`;
const start = Date.now();
const MAX_ATTEMPTS = 30;
const INTERVAL_MS = 5000;

for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  const j = (await r.json()) as PollResponse;
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`[${i}, t=${elapsed}s] state=${j.data?.state ?? '?'} progress=${j.data?.progress ?? '-'}`);

  const state = j.data?.state;
  if (state === 'success' || state === 'fail') {
    console.log('\n=== FINAL RESPONSE ===');
    console.log(JSON.stringify(j, null, 2));
    if (j.data?.resultJson) {
      try {
        console.log('\n=== Parsed resultJson ===');
        console.log(JSON.stringify(JSON.parse(j.data.resultJson), null, 2));
      } catch {
        /* ignore */
      }
    }
    process.exit(state === 'success' ? 0 : 1);
  }

  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

console.log(`\nPolling timed out after ${MAX_ATTEMPTS} attempts`);
process.exit(2);
