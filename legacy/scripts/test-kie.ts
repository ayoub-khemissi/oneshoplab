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

const BASE = 'https://api.kie.ai';

interface CreateTaskResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

async function createTask(): Promise<string | null> {
  const body = {
    model: 'gpt-image-2-image-to-image',
    input: {
      prompt: 'take a photo with Sam Altman in the conference room',
      input_urls: ['https://static.aiquickdraw.com/tools/example/1776782793756_wrogXTdd.png'],
      aspect_ratio: 'auto'
    }
  };

  console.log(`POST ${BASE}/api/v1/jobs/createTask`);
  console.log('Body:', JSON.stringify(body, null, 2));

  const r = await fetch(`${BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  console.log(`\nResponse: HTTP ${r.status}`);
  const text = await r.text();
  console.log('Body:', text.slice(0, 2000));

  try {
    const json = JSON.parse(text) as CreateTaskResponse;
    return json.data?.taskId ?? null;
  } catch {
    return null;
  }
}

async function probePollEndpoints(taskId: string): Promise<string | null> {
  const candidates = [
    `${BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/getInfo?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/queryTask?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/status?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/getRecord?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/${taskId}`,
    `${BASE}/api/v1/tasks/${taskId}`,
    `${BASE}/api/v1/task/${taskId}`,
    `${BASE}/api/v1/jobs/getResult?taskId=${taskId}`,
    `${BASE}/api/v1/jobs/queryRecord?taskId=${taskId}`
  ];

  console.log('\n--- Probing polling endpoints ---');
  let bestMatch: string | null = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
      const text = await r.text();
      const looksGood =
        r.ok &&
        text.length > 10 &&
        (text.includes('"code"') || text.includes('"data"') || text.includes('"status"') || text.includes('"taskId"'));
      console.log(`${looksGood ? '✓' : '·'} HTTP ${r.status}  ${url}`);
      if (text.length > 0 && (looksGood || r.status !== 404)) {
        console.log(`   ${text.slice(0, 250).replace(/\s+/g, ' ')}`);
      }
      if (looksGood && !bestMatch) bestMatch = url;
    } catch (e) {
      console.log(`✗ ERR    ${url}: ${(e as Error).message}`);
    }
  }
  return bestMatch;
}

async function main() {
  console.log('=== STEP 1: createTask ===\n');
  const taskId = await createTask();
  if (!taskId) {
    console.error('\n❌ No taskId returned. Cannot probe polling.');
    process.exit(1);
  }
  console.log(`\n✓ taskId = ${taskId}`);

  console.log('\n=== STEP 2: probing polling endpoints ===');
  const found = await probePollEndpoints(taskId);
  if (found) {
    console.log(`\n✓ Polling endpoint identified: ${found}`);
  } else {
    console.log('\n✗ No polling endpoint detected. Will need to consult kie.ai docs directly.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
