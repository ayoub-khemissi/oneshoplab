/**
 * Route wrapper for /api/v1: bearer + HMAC signature + permission + rate
 * limit, then `handler(req, ctx)`. Lives in the api-key entity (not
 * shared/api) because it needs the key table — `shared` has no domain
 * knowledge by the layer rules.
 */
import { eq } from 'drizzle-orm';
import { ApiError, errorResponse, take, toErrorResponse, type BucketOptions } from '@/shared/api';
import { db } from '@/shared/db';
import { projects, type ApiKeyPermission } from '@/shared/db/schema';
import { SIGNATURE_HEADER, sha256Hex, verifySignature } from '../lib/signature';
import type { ApiKeyRow, ProjectRow } from '../model/types';
import { recordKeyEvent, touchLastUsed, verifyApiKey } from './keys';

export interface SiteKeyContext {
  key: ApiKeyRow;
  project: ProjectRow;
  ip: string | null;
  /** Raw body (already consumed for the signature) and its sha256. */
  rawBody: string;
  bodyHash: string;
}

export type SiteKeyHandler = (req: Request, ctx: SiteKeyContext) => Promise<Response>;

export interface WithSiteKeyOptions {
  permission?: ApiKeyPermission;
  /** Per-key bucket for this endpoint. */
  bucket: BucketOptions;
  maxBytes?: number;
}

export const DEFAULT_BUCKET: BucketOptions = { capacity: 60, refillPerSec: 1 };
const AUTH_FAIL_BUCKET: BucketOptions = { capacity: 20, refillPerSec: 20 / 60 };
const MAX_BODY_BYTES = 1024 * 1024;
const AUTH_FAIL_EVENT_INTERVAL_MS = 60_000;
const lastAuthFailEvent = new Map<string, number>();

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64) || null;
  return req.headers.get('x-real-ip')?.slice(0, 64) ?? null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function unauthorized(ip: string | null): Response {
  // Per-IP brute-force throttle: failures share one bucket (20/min).
  const r = take(`auth-fail:${ip ?? 'unknown'}`, AUTH_FAIL_BUCKET);
  if (!r.ok) {
    return errorResponse('rate_limited', 'Too many failed attempts', 429, undefined, {
      'Retry-After': String(r.retryAfterSec)
    });
  }
  return errorResponse('unauthorized', 'Invalid or missing site key', 401);
}

async function noteAuthFailure(keyId: string, ip: string | null, reason: string): Promise<void> {
  const now = Date.now();
  const last = lastAuthFailEvent.get(keyId) ?? 0;
  if (now - last < AUTH_FAIL_EVENT_INTERVAL_MS) return;
  lastAuthFailEvent.set(keyId, now);
  await recordKeyEvent(keyId, 'auth_failed', { ip, meta: { reason } }).catch((e) =>
    console.error('[api-key] auth_failed event', e)
  );
}

export function withSiteKey(
  handler: SiteKeyHandler,
  opts: WithSiteKeyOptions
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const ip = clientIp(req);
    try {
      const token = bearer(req);
      if (!token) return unauthorized(ip);
      const verified = await verifyApiKey(token);
      if (!verified.ok) {
        if (verified.keyId) await noteAuthFailure(verified.keyId, ip, verified.reason);
        if (verified.reason === 'unauthorized') return unauthorized(ip);
        take(`auth-fail:${ip ?? 'unknown'}`, AUTH_FAIL_BUCKET);
        return errorResponse(
          verified.reason,
          verified.reason === 'key_revoked' ? 'Site key revoked' : 'Site key expired',
          401
        );
      }
      const { key } = verified;

      const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
      if (Number(req.headers.get('content-length') ?? 0) > maxBytes) {
        return errorResponse('payload_too_large', `Body exceeds ${maxBytes} bytes`, 413);
      }
      const rawBody = await req.text();
      if (Buffer.byteLength(rawBody) > maxBytes) {
        return errorResponse('payload_too_large', `Body exceeds ${maxBytes} bytes`, 413);
      }

      const sig = verifySignature(token, req.headers.get(SIGNATURE_HEADER), {
        method: req.method,
        path: new URL(req.url).pathname,
        body: rawBody
      });
      if (!sig.ok) {
        await noteAuthFailure(key.id, ip, sig.reason);
        if (sig.reason === 'clock_skew') {
          return errorResponse('clock_skew', 'Signature timestamp outside the window', 401, {
            serverTime: sig.serverTime
          });
        }
        return errorResponse('signature_invalid', 'Missing or invalid request signature', 401);
      }

      if (opts.permission && !key.permissions.includes(opts.permission)) {
        return errorResponse('forbidden', `Key lacks the ${opts.permission} permission`, 403, {
          permission: opts.permission
        });
      }

      const limit = take(`key:${key.id}:${opts.bucket.capacity}`, opts.bucket);
      if (!limit.ok) {
        return errorResponse('rate_limited', 'Rate limit exceeded', 429, undefined, {
          'Retry-After': String(limit.retryAfterSec)
        });
      }

      const [project] = await db.select().from(projects).where(eq(projects.id, key.projectId));
      if (!project) return errorResponse('unauthorized', 'Invalid or missing site key', 401);

      await touchLastUsed(key.id, ip).catch((e) => console.error('[api-key] touch', e));
      return await handler(req, { key, project, ip, rawBody, bodyHash: sha256Hex(rawBody) });
    } catch (err) {
      if (err instanceof ApiError) return toErrorResponse(err);
      return toErrorResponse(err);
    }
  };
}
