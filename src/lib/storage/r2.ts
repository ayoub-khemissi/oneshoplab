import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Canonical base URL new uploads are stamped with. After the
   *  cdn.oneshoplab.com cut-over this is the nginx-fronted domain. */
  publicUrl: string;
  /** Extra bases that point at the SAME bucket and must still resolve
   *  back to a key — chiefly the legacy `pub-xxx.r2.dev` origin so the
   *  cleanup worker can keep reclaiming objects whose stored URL
   *  predates the migration. Comma-separated in R2_PUBLIC_URL_ALIASES. */
  publicUrlAliases: string[];
}

function getConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }
  const publicUrlAliases = (process.env.R2_PUBLIC_URL_ALIASES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl,
    publicUrlAliases
  };
}

let cached: S3Client | null = null;

function getClient(): { client: S3Client; cfg: R2Config } | null {
  const cfg = getConfig();
  if (!cfg) return null;
  if (!cached) {
    cached = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      }
    });
  }
  return { client: cached, cfg };
}

export function isR2Configured(): boolean {
  return getConfig() !== null;
}

export interface UploadResult {
  key: string;
  publicUrl: string;
  contentType: string;
  size: number;
}

/**
 * Download a remote URL and re-upload to R2 under `key`. Used to persist
 * kie.ai temp result URLs (which expire after a few hours) into our own
 * permanent storage so the dashboard can display them indefinitely.
 */
export async function uploadFromUrl(sourceUrl: string, key: string): Promise<UploadResult> {
  const conn = getClient();
  if (!conn) {
    throw new Error('R2 storage is not configured (set R2_* env vars in .env)');
  }
  const { client, cfg } = conn;

  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to download ${sourceUrl}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return {
    key,
    publicUrl: `${cfg.publicUrl.replace(/\/$/, '')}/${key}`,
    contentType,
    size: buffer.length
  };
}

/**
 * Resolve a public R2 URL back to its bucket key. We persist URLs (not keys)
 * in jobs.result, so the cleanup worker needs this round-trip to call
 * DeleteObject. Returns null when the URL doesn't belong to any base that
 * maps to our bucket — that includes legacy temp kie URLs that were never
 * uploaded to R2.
 *
 * Matches against the canonical base AND every alias so a URL stored
 * before the cdn.oneshoplab.com migration (pub-xxx.r2.dev) still
 * resolves — otherwise the cleanup worker would orphan every
 * pre-migration object in R2 forever.
 */
export function keyFromPublicUrl(publicUrl: string): string | null {
  const cfg = getConfig();
  if (!cfg) return null;
  const bases = [cfg.publicUrl, ...cfg.publicUrlAliases].map((b) =>
    b.replace(/\/$/, '')
  );
  for (const base of bases) {
    if (publicUrl.startsWith(base + '/')) {
      return decodeURIComponent(publicUrl.slice(base.length + 1));
    }
  }
  return null;
}

/**
 * Delete an object from the configured R2 bucket. Best-effort: returns
 * false on any failure so the caller can log and move on without blowing
 * up the cleanup loop.
 */
export async function deleteByKey(key: string): Promise<boolean> {
  const conn = getClient();
  if (!conn) return false;
  try {
    await conn.client.send(
      new DeleteObjectCommand({ Bucket: conn.cfg.bucket, Key: key })
    );
    return true;
  } catch (e) {
    console.error('[r2] DeleteObject failed', { key, error: (e as Error).message });
    return false;
  }
}

export async function uploadBuffer(
  body: Buffer,
  key: string,
  contentType: string
): Promise<UploadResult> {
  const conn = getClient();
  if (!conn) throw new Error('R2 storage is not configured (set R2_* env vars in .env)');
  const { client, cfg } = conn;

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

  return {
    key,
    publicUrl: `${cfg.publicUrl.replace(/\/$/, '')}/${key}`,
    contentType,
    size: body.length
  };
}
