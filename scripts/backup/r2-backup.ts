/**
 * Minimal R2 helper for the backup scripts (no dependency on src/ so it keeps
 * working even if the app is broken — that is precisely when you need it).
 *
 *   tsx scripts/backup/r2-backup.ts upload   <file> <key>
 *   tsx scripts/backup/r2-backup.ts download <key> <file>
 *   tsx scripts/backup/r2-backup.ts latest   <prefix>
 *   tsx scripts/backup/r2-backup.ts list     <prefix>
 *   tsx scripts/backup/r2-backup.ts prune    <prefix> <dailyDays>   (+ R2_WEEKLY_WEEKS, default 4)
 *   tsx scripts/backup/r2-backup.ts usage    [prefix]
 *
 * Credentials come from .env (same R2_* keys as the app). Objects under
 * `backups/` are blocked at the CDN (nginx) and encrypted with gpg anyway.
 */
import { existsSync, readFileSync, createReadStream, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';

// Load .env by hand — never import src/ here.
const envPath = new URL('../../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const bucket = need('R2_BUCKET');
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY')
  }
});

async function list(prefix: string) {
  const out: { key: string; size: number; lastModified: Date }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) {
      if (o.Key && o.LastModified)
        out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'upload': {
      if (!a || !b) throw new Error('usage: upload <file> <key>');
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: b,
          Body: createReadStream(a),
          ContentLength: statSync(a).size,
          ContentType: 'application/octet-stream'
        })
      );
      console.info(`uploaded ${a} → ${b}`);
      return;
    }
    case 'download': {
      if (!a || !b) throw new Error('usage: download <key> <file>');
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: a }));
      await pipeline(res.Body as Readable, createWriteStream(b));
      console.info(`downloaded ${a} → ${b}`);
      return;
    }
    case 'latest': {
      const objs = await list(a ?? 'backups/mysql/');
      if (!objs.length) throw new Error('no backup found');
      console.info(objs[objs.length - 1].key);
      return;
    }
    case 'list': {
      for (const o of await list(a ?? 'backups/mysql/'))
        console.info(`${o.lastModified.toISOString()}  ${String(o.size).padStart(12)}  ${o.key}`);
      return;
    }
    case 'prune': {
      // Grandfather-father-son on a budget (R2 free tier is small): keep every
      // backup from the last DAILY_DAYS days, then only the first backup of
      // each ISO week for WEEKLY_WEEKS weeks. Never delete the newest object.
      const dailyDays = Number(b ?? 7);
      const weeklyWeeks = Number(process.env.R2_WEEKLY_WEEKS ?? 4);
      if (!a || !Number.isFinite(dailyDays) || dailyDays < 3)
        throw new Error('usage: prune <prefix> <dailyDays≥3>');
      const objs = await list(a);
      const now = Date.now();
      const dailyCutoff = now - dailyDays * 86_400_000;
      const weeklyCutoff = now - (dailyDays + weeklyWeeks * 7) * 86_400_000;
      const weeksKept = new Set<string>();
      const keep = new Set<string>();
      for (const o of objs) {
        const t = o.lastModified.getTime();
        if (t >= dailyCutoff) keep.add(o.key);
        else if (t >= weeklyCutoff) {
          const wk = isoWeek(o.lastModified);
          if (!weeksKept.has(wk)) {
            weeksKept.add(wk);
            keep.add(o.key);
          }
        }
      }
      if (objs.length) keep.add(objs[objs.length - 1].key);
      let removed = 0;
      for (const o of objs) {
        if (keep.has(o.key)) continue;
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.key }));
        console.info(`pruned ${o.key}`);
        removed++;
      }
      const kept = objs.filter((o) => keep.has(o.key));
      const bytes = kept.reduce((n, o) => n + o.size, 0);
      console.info(
        `prune: ${removed} removed, ${kept.length} kept (${(bytes / 1e9).toFixed(2)} GB)`
      );
      return;
    }
    case 'usage': {
      // Whole-bucket footprint, grouped by top-level prefix.
      const objs = await list(a ?? '');
      const byPrefix = new Map<string, { n: number; bytes: number }>();
      for (const o of objs) {
        const p = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
        const e = byPrefix.get(p) ?? { n: 0, bytes: 0 };
        e.n++;
        e.bytes += o.size;
        byPrefix.set(p, e);
      }
      let total = 0;
      for (const [p, e] of [...byPrefix].sort((x, y) => y[1].bytes - x[1].bytes)) {
        total += e.bytes;
        console.info(
          `${(e.bytes / 1e9).toFixed(2).padStart(8)} GB  ${String(e.n).padStart(7)}  ${p}`
        );
      }
      console.info(`${(total / 1e9).toFixed(2).padStart(8)} GB  total`);
      return;
    }
    default:
      throw new Error('commands: upload | download | latest | list | prune | usage');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
